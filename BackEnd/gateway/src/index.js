const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { correlationId, requireJsonContent } = require('./security');

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
const IDENTITY_URL = process.env.IDENTITY_URL || 'http://identity:3001';
const TRANSACTION_URL = process.env.TRANSACTION_URL || 'http://transaction:3002';
const AI_URL = process.env.AI_URL || 'http://ai:3003';
const GAM_URL = process.env.GAMIFICATION_URL || 'http://gamification:3004';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-XSS-Protection', '0');
  next();
});
app.use(correlationId);
app.use(requireJsonContent);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const authLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
const globalLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false });
app.use(globalLimiter);

app.get('/health', (req, res) => res.json({ success: true, data: { service: 'gateway', status: 'up' } }));

// JWT-open paths (no bearer needed)
const OPEN_PATHS = new Set([
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
  'GET /api/v1/game/badges',
  'GET /api/v1/game/leaderboard',
  'GET /api/v1/ai/accuracy',
  'GET /api/v1/ai/openapi.json',
  'GET /api/v1/transactions/openapi.json'
]);
function isOpen(req) {
  const key = `${req.method} ${req.path.split('?')[0]}`;
  if (OPEN_PATHS.has(key)) return true;
  const p = req.path.split('?')[0];
  if (p.startsWith('/api/v1/ai/docs') || p.startsWith('/api/v1/transactions/docs')) return true;
  return false;
}

function verifyJwt(req, res, next) {
  if (isOpen(req)) return next();
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ success: false, error: { message: 'Missing token' } });
  try { jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ success: false, error: { message: 'Invalid token' } }); }
}
app.use(verifyJwt);

// Read raw body for POST/PATCH/PUT before proxying
function bufferBody(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  let chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => { req._rawBody = Buffer.concat(chunks); next(); });
  req.on('error', next);
}
app.use(bufferBody);

// AI internal endpoints must not be exposed externally
app.use('/api/v1/ai', (req, res, next) => {
  const p = req.path.split('?')[0];
  if (p === '/accuracy' || p === '/health' || p === '/openapi.json' || p.startsWith('/docs')) return next();
  return res.status(403).json({ success: false, error: { message: 'AI internal endpoint dışarıya kapalı' } });
});

// Simple proxy using fetch — strip mount prefix, forward to upstream
async function proxyTo(upstream, mount, req, res) {
  const original = req.originalUrl; // /api/v1/transactions/xxx?q=1
  const stripped = original.slice(mount.length); // e.g. /xxx?q=1
  const url = upstream + stripped;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  if (req.correlationId) headers['x-correlation-id'] = req.correlationId;
  const init = { method: req.method, headers };
  if (req._rawBody && req._rawBody.length) init.body = req._rawBody;
  try {
    const r = await fetch(url, init);
    res.status(r.status);
    r.headers.forEach((v, k) => {
      if (['transfer-encoding', 'content-encoding', 'connection'].includes(k.toLowerCase())) return;
      res.setHeader(k, v);
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) {
    if (!res.headersSent) res.status(503).json({ success: false, error: { message: 'Upstream unavailable' } });
  }
}

// Docs and openapi routes forward to the service root (no /transactions prefix)
app.use('/api/v1/transactions/docs', (req, res) => proxyTo(TRANSACTION_URL + '/docs', '/api/v1/transactions/docs', req, res));
app.use('/api/v1/transactions/openapi.json', (req, res) => proxyTo(TRANSACTION_URL + '/openapi.json', '/api/v1/transactions/openapi.json', req, res));

const ROUTES = [
  ['/api/v1/auth', IDENTITY_URL + '/auth', authLimiter],
  ['/api/v1/users', IDENTITY_URL + '/users'],
  ['/api/v1/audit-logs', IDENTITY_URL + '/audit-logs'],
  ['/api/v1/transactions', TRANSACTION_URL + '/transactions'],
  ['/api/v1/cases', TRANSACTION_URL + '/cases'],
  ['/api/v1/dashboard', TRANSACTION_URL + '/dashboard'],
  ['/api/v1/ai', AI_URL],
  ['/api/v1/game', GAM_URL]
];

for (const [mount, upstream, ...mws] of ROUTES) {
  app.use(mount, ...mws, (req, res) => proxyTo(upstream, mount, req, res));
}

app.use((req, res) => res.status(404).json({ success: false, error: { message: 'Not found' } }));

app.listen(PORT, () => console.log(`[gateway] listening :${PORT}`));
