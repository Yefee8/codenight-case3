const express = require('express');
const jwt = require('jsonwebtoken');
const { db, uid } = require('./db');
const { securityHeaders, correlationId, requireJsonContent } = require('./security');

const PORT = process.env.PORT || 3004;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 'dev-service-token';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(correlationId);
app.use(requireJsonContent);
app.use(express.json({ limit: '32kb' }));

function ok(res, data) { res.json({ success: true, data }); }
function err(res, code, message) { res.status(code).json({ success: false, error: { message } }); }
function serviceOnly(req, res, next) {
  if (req.headers['x-service-token'] !== SERVICE_TOKEN) return err(res, 401, 'Service token required');
  next();
}
function authOptional(req, res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try { req.user = jwt.verify(h.slice(7), JWT_SECRET); } catch (e) {}
  }
  next();
}
function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return err(res, 401, 'Missing token');
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch (e) { return err(res, 401, 'Invalid token'); }
}

function addPoints(userId, point, reason, caseId) {
  db.prepare('INSERT INTO points (id, user_id, point, reason, case_id, created_at) VALUES (?,?,?,?,?,?)')
    .run(uid(), userId, point, reason, caseId || null, new Date().toISOString());
}

function getStats(userId) {
  let s = db.prepare('SELECT * FROM user_stats WHERE user_id=?').get(userId);
  if (!s) {
    db.prepare('INSERT INTO user_stats (user_id) VALUES (?)').run(userId);
    s = db.prepare('SELECT * FROM user_stats WHERE user_id=?').get(userId);
  }
  return s;
}
function updateStats(userId, fn) {
  const s = getStats(userId);
  const byType = JSON.parse(s.by_type || '{}');
  const next = fn({ ...s, by_type: byType });
  db.prepare(`UPDATE user_stats SET total_cases=?, fraud_confirmed=?, wrong_blocks=?, fast_decisions=?, critical_solved=?, by_type=? WHERE user_id=?`)
    .run(next.total_cases, next.fraud_confirmed, next.wrong_blocks, next.fast_decisions, next.critical_solved, JSON.stringify(next.by_type), userId);
  return next;
}

function totalPoints(userId) {
  const r = db.prepare('SELECT COALESCE(SUM(point),0) t FROM points WHERE user_id=?').get(userId);
  return r.t || 0;
}
function level(pts) {
  if (pts >= 3000) return 'PLATIN';
  if (pts >= 1500) return 'ALTIN';
  if (pts >= 500) return 'GUMUS';
  return 'BRONZ';
}

function awardBadge(userId, code, meta) {
  const b = db.prepare('SELECT * FROM badges WHERE code=?').get(code);
  if (!b) return null;
  const has = db.prepare('SELECT 1 FROM user_badges WHERE user_id=? AND badge_id=?').get(userId, b.id);
  if (has) return null;
  db.prepare('INSERT INTO user_badges (user_id, badge_id, created_at) VALUES (?,?,?)').run(userId, b.id, new Date().toISOString());
  db.prepare('INSERT INTO notifications (id, user_id, type, payload, created_at, seen) VALUES (?,?,?,?,?,0)')
    .run(uid(), userId, 'badge.earned', JSON.stringify({ code, name: b.name, ...meta }), new Date().toISOString());
  return b;
}

function checkBadges(userId, stats) {
  const earned = [];
  if (stats.fraud_confirmed >= 1) earned.push('ILK_YAKALAMA');
  if (stats.fast_decisions >= 10) earned.push('KESKIN_GOZ');
  if (stats.total_cases >= 50 && stats.wrong_blocks === 0) earned.push('SIFIR_HATA');
  if (stats.critical_solved >= 10) earned.push('KRIZ_YONETICISI');
  for (const [t, count] of Object.entries(stats.by_type || {})) {
    if (count >= 50) earned.push('UZMAN_AVCI');
  }
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = db.prepare("SELECT COUNT(*) c FROM points WHERE user_id=? AND reason='CASE_DECIDED' AND substr(created_at,1,10)=?").get(userId, today).c;
  if (todayCount >= 20) earned.push('MARATONCU');
  return earned.map(code => awardBadge(userId, code)).filter(Boolean);
}

app.get('/health', (req, res) => ok(res, { service: 'gamification', status: 'up' }));

app.post('/events/case-decided', serviceOnly, (req, res) => {
  const { analyst_id, decision, fraud_type, risk_level, decision_ms, sla_ms, customer_confirmed_fraud } = req.body || {};
  if (!analyst_id) return err(res, 400, 'analyst_id gerekli');

  const events = [];
  if (decision === 'BLOKLANDI' || decision === 'ONAYLANDI') {
    addPoints(analyst_id, 10, 'CASE_DECIDED', req.body.case_id);
    events.push({ delta: +10, reason: 'CASE_DECIDED' });
  }
  const fast = decision_ms && decision_ms < 15 * 60 * 1000;
  if (fast) { addPoints(analyst_id, 5, 'FAST_DECISION', req.body.case_id); events.push({ delta: +5, reason: 'FAST_DECISION' }); }

  const critSla = risk_level === 'KRITIK' && sla_ms && decision_ms && decision_ms < sla_ms;
  if (critSla) { addPoints(analyst_id, 15, 'KRITIK_SLA_OK', req.body.case_id); events.push({ delta: +15, reason: 'KRITIK_SLA_OK' }); }

  if (customer_confirmed_fraud) { addPoints(analyst_id, 15, 'REAL_FRAUD_CAUGHT', req.body.case_id); events.push({ delta: +15, reason: 'REAL_FRAUD_CAUGHT' }); }

  const stats = updateStats(analyst_id, s => {
    s.total_cases += 1;
    if (customer_confirmed_fraud) s.fraud_confirmed += 1;
    if (fast) s.fast_decisions += 1;
    if (critSla) s.critical_solved += 1;
    if (fraud_type && decision === 'BLOKLANDI' && customer_confirmed_fraud) {
      s.by_type[fraud_type] = (s.by_type[fraud_type] || 0) + 1;
    }
    return s;
  });
  const badges = checkBadges(analyst_id, stats);
  ok(res, { applied: events, badges_awarded: badges.map(b => ({ code: b.code, name: b.name })) });
});

app.post('/events/wrong-block', serviceOnly, (req, res) => {
  const { analyst_id, case_id } = req.body || {};
  if (!analyst_id) return err(res, 400, 'analyst_id gerekli');
  addPoints(analyst_id, -8, 'WRONG_BLOCK', case_id);
  updateStats(analyst_id, s => { s.wrong_blocks += 1; return s; });
  ok(res, { applied: -8 });
});

app.post('/events/sla-exceeded', serviceOnly, (req, res) => {
  const { analyst_id, case_id } = req.body || {};
  if (!analyst_id) return err(res, 400, 'analyst_id gerekli');
  addPoints(analyst_id, -5, 'SLA_EXCEEDED', case_id);
  ok(res, { applied: -5 });
});

// Customer feedback rating (1-5 stars) — record + gentle points nudge, notify analyst
app.post('/events/customer-feedback', serviceOnly, (req, res) => {
  const { analyst_id, case_id, rating } = req.body || {};
  if (!analyst_id || !rating) return err(res, 400, 'analyst_id ve rating gerekli');
  db.prepare('INSERT INTO customer_feedback_events (id, analyst_id, case_id, rating, created_at) VALUES (?,?,?,?,?)')
    .run(uid(), analyst_id, case_id || null, rating, new Date().toISOString());
  db.prepare('INSERT INTO notifications (id, user_id, type, payload, created_at, seen) VALUES (?,?,?,?,?,0)')
    .run(uid(), analyst_id, 'customer.feedback', JSON.stringify({ case_id, rating }), new Date().toISOString());
  ok(res, { recorded: true });
});

app.get('/leaderboard', (req, res) => {
  const period = req.query.period || 'daily';
  let since;
  if (period === 'weekly') since = new Date(Date.now() - 7 * 86400 * 1000);
  else since = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const rows = db.prepare(`SELECT user_id, SUM(point) total FROM points WHERE created_at >= ? GROUP BY user_id ORDER BY total DESC LIMIT 10`).all(since.toISOString());
  ok(res, { period, items: rows.map((r, i) => ({ rank: i + 1, user_id: r.user_id, points: r.total })) });
});

app.get('/badges', (req, res) => {
  ok(res, db.prepare('SELECT code, name, description FROM badges').all());
});

app.get('/profile', authRequired, (req, res) => {
  const userId = req.user.sub;
  const pts = totalPoints(userId);
  const badges = db.prepare(`SELECT b.code, b.name, b.description, ub.created_at FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=?`).all(userId);
  const stats = getStats(userId);
  const today = new Date().toISOString().slice(0, 10);
  const dailyPoints = db.prepare("SELECT COALESCE(SUM(point),0) t FROM points WHERE user_id=? AND substr(created_at,1,10)=?").get(userId, today).t;
  ok(res, {
    user_id: userId,
    total_points: pts,
    daily_points: dailyPoints,
    level: level(pts),
    total_cases: stats.total_cases,
    fraud_confirmed: stats.fraud_confirmed,
    badges
  });
});

app.get('/profile/:userId', authRequired, (req, res) => {
  if (req.user.role !== 'SUPERVISOR' && req.user.role !== 'ADMIN' && req.user.sub !== req.params.userId) return err(res, 403, 'Forbidden');
  const userId = req.params.userId;
  const pts = totalPoints(userId);
  const badges = db.prepare(`SELECT b.code, b.name, b.description, ub.created_at FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=?`).all(userId);
  const stats = getStats(userId);
  ok(res, { user_id: userId, total_points: pts, level: level(pts), stats, badges });
});

app.get('/notifications', authRequired, (req, res) => {
  const rows = db.prepare('SELECT id, type, payload, created_at, seen FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(req.user.sub);
  ok(res, rows.map(r => ({ ...r, payload: JSON.parse(r.payload), seen: !!r.seen })));
});

app.patch('/notifications/:id/seen', authRequired, (req, res) => {
  const info = db.prepare('UPDATE notifications SET seen=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.sub);
  if (info.changes === 0) return err(res, 404, 'Bildirim yok');
  ok(res, { id: req.params.id, seen: true });
});

app.use((req, res) => err(res, 404, 'Not found'));
app.listen(PORT, () => console.log(`[gamification] listening :${PORT}`));
