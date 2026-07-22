const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db, uid } = require('./db');
const { sanitize, securityHeaders, correlationId, requireJsonContent } = require('./security');

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 'dev-service-token';
const ACCESS_TTL = 15 * 60;
const REFRESH_TTL_DAYS = 7;
const LOCK_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const OTP_FIXED = '1234';

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(correlationId);
app.use(requireJsonContent);
app.use(express.json({ limit: '32kb' }));

function ok(res, data) { res.json({ success: true, data }); }
function err(res, code, message, details) { res.status(code).json({ success: false, error: { message, details } }); }

function audit(userId, action, resource, success, ip, metadata) {
  db.prepare('INSERT INTO audit_logs (id, user_id, action, resource, success, ip, metadata, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(uid(), userId, action, resource || null, success ? 1 : 0, ip || null, metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
}

function getSpecialties(userId) {
  return db.prepare('SELECT specialty FROM user_specialties WHERE user_id = ?').all(userId).map(r => r.specialty);
}

function issueAccess(user) {
  return jwt.sign({
    sub: user.id, role: user.role, region: user.region, specialties: getSpecialties(user.id)
  }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

function hashToken(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

function issueRefresh(userId, replacedBy = null) {
  const raw = crypto.randomBytes(48).toString('hex');
  const now = new Date();
  const exp = new Date(now.getTime() + REFRESH_TTL_DAYS * 86400 * 1000);
  db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, replaced_by, created_at) VALUES (?,?,?,?,0,?,?)')
    .run(uid(), userId, hashToken(raw), exp.toISOString(), replacedBy, now.toISOString());
  return raw;
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return err(res, 401, 'Missing token');
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) { return err(res, 401, 'Invalid token'); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      audit(req.user && req.user.sub, 'FORBIDDEN', req.originalUrl, false, req.ip);
      return err(res, 403, 'Forbidden');
    }
    next();
  };
}

function serviceOnly(req, res, next) {
  if (req.headers['x-service-token'] !== SERVICE_TOKEN) return err(res, 401, 'Service token required');
  next();
}

function validatePassword(p) {
  if (!p || p.length < 8) return 'Şifre en az 8 karakter olmalıdır';
  if (!/[A-Z]/.test(p)) return 'En az 1 büyük harf içermelidir';
  if (!/[0-9]/.test(p)) return 'En az 1 rakam içermelidir';
  if (!/[^A-Za-z0-9]/.test(p)) return 'En az 1 özel karakter içermelidir';
  return null;
}

app.get('/health', (req, res) => ok(res, { service: 'identity', status: 'up' }));

app.post('/auth/register', (req, res) => {
  const first_name = sanitize(req.body && req.body.first_name, 64);
  const last_name = sanitize(req.body && req.body.last_name, 64);
  const gsm = sanitize(req.body && req.body.gsm, 15);
  const email = sanitize(req.body && req.body.email, 128);
  const { otp } = req.body || {};
  if (!first_name || !last_name || !gsm) return err(res, 400, 'first_name, last_name, gsm zorunlu');
  if (!/^\d{10,11}$/.test(gsm)) return err(res, 400, 'GSM geçersiz');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'E-posta geçersiz');
  if (otp !== OTP_FIXED) return err(res, 400, 'Geçersiz OTP');
  const exists = db.prepare('SELECT id FROM users WHERE gsm = ?').get(gsm);
  if (exists) return err(res, 409, 'Bu GSM ile kayıtlı kullanıcı var');
  const now = new Date().toISOString();
  const id = uid();
  db.prepare(`INSERT INTO users (id, first_name, last_name, gsm, email, password_hash, role, status, region, failed_attempts, created_at, updated_at)
    VALUES (?,?,?,?,?,NULL,'CUSTOMER','ACTIVE',NULL,0,?,?)`)
    .run(id, first_name, last_name, gsm, email || null, now, now);
  audit(id, 'REGISTER', 'user:' + id, true, req.ip);
  ok(res, { id, gsm });
});

app.post('/auth/login', (req, res) => {
  const { email, password, gsm, otp } = req.body || {};
  let user;
  if (gsm && otp) {
    user = db.prepare('SELECT * FROM users WHERE gsm = ?').get(gsm);
    if (!user) { audit(null, 'LOGIN', 'gsm:' + gsm, false, req.ip); return err(res, 401, 'Geçersiz kimlik'); }
    if (user.status !== 'ACTIVE') return err(res, 403, 'Hesap aktif değil');
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return err(res, 423, 'Hesap kilitli', { remaining_minutes: remaining });
    }
    if (otp !== OTP_FIXED) {
      registerFailure(user);
      audit(user.id, 'LOGIN', 'user:' + user.id, false, req.ip, { reason: 'otp' });
      return err(res, 401, 'Geçersiz OTP');
    }
  } else if (email && password) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !user.password_hash) { audit(null, 'LOGIN', 'email:' + email, false, req.ip); return err(res, 401, 'Geçersiz kimlik'); }
    if (user.status !== 'ACTIVE') return err(res, 403, 'Hesap aktif değil');
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return err(res, 423, 'Hesap kilitli', { remaining_minutes: remaining });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      registerFailure(user);
      audit(user.id, 'LOGIN', 'user:' + user.id, false, req.ip, { reason: 'password' });
      return err(res, 401, 'Geçersiz kimlik');
    }
  } else {
    return err(res, 400, 'email+password ya da gsm+otp gerekli');
  }
  db.prepare('UPDATE users SET failed_attempts=0, locked_until=NULL, updated_at=? WHERE id=?').run(new Date().toISOString(), user.id);
  audit(user.id, 'LOGIN', 'user:' + user.id, true, req.ip);
  const access = issueAccess(user);
  const refresh = issueRefresh(user.id);
  ok(res, { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: ACCESS_TTL, user: publicUser(user) });
});

function registerFailure(user) {
  const attempts = (user.failed_attempts || 0) + 1;
  let lockedUntil = null;
  if (attempts >= MAX_ATTEMPTS) {
    lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
  }
  db.prepare('UPDATE users SET failed_attempts=?, locked_until=?, updated_at=? WHERE id=?')
    .run(attempts, lockedUntil, new Date().toISOString(), user.id);
  if (lockedUntil) audit(user.id, 'ACCOUNT_LOCKED', 'user:' + user.id, true, null, { until: lockedUntil });
}

function publicUser(u) {
  return { id: u.id, first_name: u.first_name, last_name: u.last_name, gsm: u.gsm, email: u.email, role: u.role, region: u.region, specialties: getSpecialties(u.id) };
}

app.post('/auth/refresh', (req, res) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return err(res, 400, 'refresh_token gerekli');
  const h = hashToken(refresh_token);
  const rec = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(h);
  if (!rec) return err(res, 401, 'Geçersiz refresh token');
  if (rec.revoked) {
    db.prepare('UPDATE refresh_tokens SET revoked=1 WHERE user_id=? AND revoked=0').run(rec.user_id);
    audit(rec.user_id, 'TOKEN_REUSE_DETECTED', 'user:' + rec.user_id, false, req.ip);
    return err(res, 401, 'Token yeniden kullanımı tespit edildi, tüm oturumlar sonlandırıldı');
  }
  if (new Date(rec.expires_at) < new Date()) return err(res, 401, 'Refresh token süresi doldu');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(rec.user_id);
  if (!user || user.status !== 'ACTIVE') return err(res, 401, 'Kullanıcı aktif değil');
  const newRaw = issueRefresh(user.id);
  db.prepare('UPDATE refresh_tokens SET revoked=1, replaced_by=? WHERE id=?').run(hashToken(newRaw), rec.id);
  ok(res, { access_token: issueAccess(user), refresh_token: newRaw, token_type: 'Bearer', expires_in: ACCESS_TTL });
});

app.post('/auth/logout', (req, res) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return err(res, 400, 'refresh_token gerekli');
  db.prepare('UPDATE refresh_tokens SET revoked=1 WHERE token_hash=?').run(hashToken(refresh_token));
  ok(res, { logged_out: true });
});

app.get('/users/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.sub);
  if (!user) return err(res, 404, 'Kullanıcı bulunamadı');
  ok(res, publicUser(user));
});

app.post('/users/staff', authRequired, requireRole('ADMIN'), (req, res) => {
  const first_name = sanitize(req.body && req.body.first_name, 64);
  const last_name = sanitize(req.body && req.body.last_name, 64);
  const email = sanitize(req.body && req.body.email, 128);
  const region = sanitize(req.body && req.body.region, 64);
  const { password, role, specialties } = req.body || {};
  if (!first_name || !last_name || !email || !password || !role) return err(res, 400, 'Eksik alan');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'E-posta geçersiz');
  if (!['ANALYST', 'SUPERVISOR', 'ADMIN'].includes(role)) return err(res, 400, 'Geçersiz rol');
  const v = validatePassword(password);
  if (v) return err(res, 400, v);
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return err(res, 409, 'E-posta zaten kayıtlı');
  const id = uid();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO users (id, first_name, last_name, email, password_hash, role, status, region, failed_attempts, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, first_name, last_name, email, bcrypt.hashSync(password, 10), role, 'ACTIVE', region || null, 0, now, now);
  if (Array.isArray(specialties)) {
    const ins = db.prepare('INSERT OR IGNORE INTO user_specialties (user_id, specialty) VALUES (?,?)');
    specialties.forEach(s => ins.run(id, s));
  }
  audit(req.user.sub, 'STAFF_CREATED', 'user:' + id, true, req.ip, { role });
  ok(res, { id, email, role });
});

app.get('/audit-logs', authRequired, requireRole('ADMIN'), (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all();
  ok(res, rows.map(r => ({ ...r, success: !!r.success, metadata: r.metadata ? JSON.parse(r.metadata) : null })));
});

app.get('/internal/analysts', serviceOnly, (req, res) => {
  const rows = db.prepare("SELECT id, first_name, last_name, region FROM users WHERE role='ANALYST' AND status='ACTIVE'").all();
  ok(res, rows.map(r => ({ ...r, specialties: getSpecialties(r.id) })));
});

app.get('/internal/users/:id', serviceOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return err(res, 404, 'Bulunamadı');
  ok(res, publicUser(u));
});

app.use((req, res) => err(res, 404, 'Not found'));

app.listen(PORT, () => console.log(`[identity] listening :${PORT}`));
