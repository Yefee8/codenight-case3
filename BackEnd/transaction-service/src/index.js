const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const yaml = require('yamljs');
const { db, uid, nextTrxNumber } = require('./db');
const { canTransition } = require('./stateMachine');
const { sanitize, securityHeaders, correlationId, requireJsonContent } = require('./security');

const openapiSpec = yaml.load(path.join(__dirname, 'openapi.yaml'));

const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 'dev-service-token';
const AI_URL = process.env.AI_URL || 'http://ai:3003';
const GAM_URL = process.env.GAMIFICATION_URL || 'http://gamification:3004';

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(correlationId);
app.use(requireJsonContent);
app.use(express.json({ limit: '64kb' }));

function ok(res, data) { res.json({ success: true, data }); }
function err(res, code, message, details) { res.status(code).json({ success: false, error: { message, details } }); }

function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return err(res, 401, 'Missing token');
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch (e) { return err(res, 401, 'Invalid token'); }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return err(res, 403, 'Forbidden');
    next();
  };
}

// SLA per PDF 4.4
const SLA_MS = {
  KRITIK: 15 * 60 * 1000,
  YUKSEK: 60 * 60 * 1000,
  ORTA: 4 * 60 * 60 * 1000,
  DUSUK: 24 * 60 * 60 * 1000
};

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j, ok: r.ok };
}

async function callAiScore(trx, customer) {
  try {
    const res = await fetchJson(`${AI_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': SERVICE_TOKEN },
      body: JSON.stringify({
        transaction_id: trx.id,
        amount: trx.amount,
        type: trx.type,
        city: trx.city,
        device: trx.device,
        receiver: trx.receiver,
        timestamp: trx.created_at,
        customer_history: {
          avg_amount: 500,
          home_city: customer && customer.region ? customer.region : 'ISTANBUL',
          known_device: false
        }
      })
    });
    if (!res.ok) return null;
    return res.body.data;
  } catch (e) {
    return null;
  }
}

async function callAiAssign(caseId, fraudType) {
  try {
    const res = await fetchJson(`${AI_URL}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': SERVICE_TOKEN },
      body: JSON.stringify({ case_id: caseId, fraud_type: fraudType })
    });
    if (!res.ok) return null;
    return res.body.data.analyst_id;
  } catch (e) { return null; }
}

async function notifyGamification(path, payload) {
  try {
    await fetchJson(`${GAM_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': SERVICE_TOKEN },
      body: JSON.stringify(payload)
    });
  } catch (e) { /* fire-and-forget */ }
}

async function reportAiDecision(analystId, correct) {
  try {
    await fetchJson(`${AI_URL}/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': SERVICE_TOKEN },
      body: JSON.stringify({ analyst_id: analystId, correct })
    });
  } catch (e) {}
}

function historyRow(caseId, from, to, by, note) {
  db.prepare('INSERT INTO case_history (id, case_id, from_status, to_status, performed_by, note, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(uid(), caseId, from, to, by, note || null, new Date().toISOString());
}

app.get('/health', (req, res) => ok(res, { service: 'transaction', status: 'up' }));
app.get('/openapi.json', (req, res) => res.json(openapiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: 'FraudCell Transaction API' }));

// POST /transactions
app.post('/transactions', authRequired, requireRole('CUSTOMER', 'ADMIN'), async (req, res) => {
  const { amount, type } = req.body || {};
  const receiver = sanitize(req.body && req.body.receiver, 128);
  const device = sanitize(req.body && req.body.device, 64) || 'UNKNOWN';
  const city = sanitize(req.body && req.body.city, 64);
  if (typeof amount !== 'number' || amount <= 0 || amount > 10_000_000) return err(res, 400, 'Geçerli tutar gerekli');
  const validTypes = ['ODEME', 'TRANSFER', 'FATURA', 'CEKIM'];
  if (!validTypes.includes(type)) return err(res, 400, 'Geçersiz işlem tipi');

  // Idempotency-Key (case §10)
  const idemKey = req.headers['idempotency-key'];
  if (idemKey) {
    const prev = db.prepare('SELECT response FROM idempotency WHERE key=? AND user_id=?').get(idemKey, req.user.sub);
    if (prev) return res.json(JSON.parse(prev.response));
  }

  const id = uid();
  const now = new Date().toISOString();
  const trxNumber = nextTrxNumber();
  const trx = { id, trx_number: trxNumber, customer_id: req.user.sub, amount, type, receiver: receiver || '', device, city: city || '', status: 'PENDING', created_at: now };

  db.prepare(`INSERT INTO transactions (id, trx_number, customer_id, amount, type, receiver, device, city, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, trx.trx_number, req.user.sub, amount, type, trx.receiver, trx.device, trx.city, 'PENDING', now);

  const scoring = await callAiScore(trx, { region: req.user.region });

  let risk_score, risk_level, fraud_type, decision, prediction_id;
  if (!scoring) {
    // AI unavailable — mark BELIRSIZ, manual queue
    risk_score = null;
    risk_level = 'BELIRSIZ';
    fraud_type = 'SUPHELI_DAVRANIS';
    decision = 'INCELEME';
    prediction_id = null;
  } else {
    ({ risk_score, risk_level, fraud_type, decision, prediction_id } = scoring);
  }

  db.prepare('UPDATE transactions SET risk_score=?, risk_level=?, fraud_type=?, prediction_id=?, status=? WHERE id=?')
    .run(risk_score, risk_level, fraud_type, prediction_id, decision === 'ONAY' ? 'ONAYLI' : (decision === 'BLOK' ? 'GECICI_BLOK' : 'INCELEMEDE'), id);

  let caseRow = null;
  if (decision !== 'ONAY') {
    const caseId = uid();
    const sla = SLA_MS[risk_level] || SLA_MS.ORTA;
    const sla_deadline = new Date(Date.now() + sla).toISOString();
    db.prepare(`INSERT INTO cases (id, transaction_id, status, sla_deadline, created_at, updated_at)
      VALUES (?, ?, 'YENI', ?, ?, ?)`).run(caseId, id, sla_deadline, now, now);
    historyRow(caseId, null, 'YENI', 'SYSTEM', 'Vaka oluşturuldu');

    // Auto assign via AI (or manual queue if unavailable/no capacity)
    const analystId = await callAiAssign(caseId, fraud_type);
    if (analystId) {
      db.prepare("UPDATE cases SET status='ATANDI', assigned_to=?, updated_at=? WHERE id=?").run(analystId, new Date().toISOString(), caseId);
      historyRow(caseId, 'YENI', 'ATANDI', 'SYSTEM', 'AI otomatik atama');
    }
    caseRow = db.prepare('SELECT * FROM cases WHERE id=?').get(caseId);
  }

  const trxOut = db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
  const payload = { success: true, data: { transaction: trxOut, case: caseRow, ai_available: !!scoring } };
  if (idemKey) {
    try {
      db.prepare('INSERT INTO idempotency (key, user_id, response, created_at) VALUES (?,?,?,?)')
        .run(idemKey, req.user.sub, JSON.stringify(payload), new Date().toISOString());
    } catch (e) {}
  }
  res.json(payload);
});

// GET /transactions — role-based visibility
app.get('/transactions', authRequired, (req, res) => {
  let rows;
  if (req.user.role === 'CUSTOMER') rows = db.prepare('SELECT * FROM transactions WHERE customer_id=? ORDER BY created_at DESC LIMIT 200').all(req.user.sub);
  else rows = db.prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200').all();
  ok(res, rows);
});

app.get('/transactions/:id', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM transactions WHERE id=?').get(req.params.id);
  if (!t) return err(res, 404, 'İşlem bulunamadı');
  if (req.user.role === 'CUSTOMER' && t.customer_id !== req.user.sub) return err(res, 403, 'Forbidden');
  ok(res, t);
});

// Cases
app.get('/cases', authRequired, (req, res) => {
  let rows;
  if (req.user.role === 'ANALYST') rows = db.prepare('SELECT * FROM cases WHERE assigned_to=? ORDER BY sla_deadline ASC').all(req.user.sub);
  else if (req.user.role === 'SUPERVISOR' || req.user.role === 'ADMIN') rows = db.prepare('SELECT * FROM cases ORDER BY sla_deadline ASC LIMIT 200').all();
  else {
    // Customer sees cases for their transactions
    rows = db.prepare(`SELECT c.* FROM cases c JOIN transactions t ON t.id=c.transaction_id WHERE t.customer_id=? ORDER BY c.created_at DESC`).all(req.user.sub);
  }
  ok(res, rows);
});

app.get('/cases/:id', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM cases WHERE id=?').get(req.params.id);
  if (!c) return err(res, 404, 'Vaka bulunamadı');
  const t = db.prepare('SELECT * FROM transactions WHERE id=?').get(c.transaction_id);
  if (req.user.role === 'CUSTOMER' && t.customer_id !== req.user.sub) return err(res, 403, 'Forbidden');
  if (req.user.role === 'ANALYST' && c.assigned_to !== req.user.sub) return err(res, 403, 'Forbidden');
  const history = db.prepare('SELECT * FROM case_history WHERE case_id=? ORDER BY created_at ASC').all(c.id);
  ok(res, { ...c, transaction: t, history });
});

// PATCH /cases/:id/status
app.patch('/cases/:id/status', authRequired, requireRole('ANALYST', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const { to } = req.body || {};
  const note = sanitize(req.body && req.body.note, 500);
  const c = db.prepare('SELECT * FROM cases WHERE id=?').get(req.params.id);
  if (!c) return err(res, 404, 'Vaka bulunamadı');
  if (req.user.role === 'ANALYST' && c.assigned_to !== req.user.sub) return err(res, 403, 'Bu vaka size atanmamış');
  const check = canTransition(c.status, to, req.user.role);
  if (!check.ok) return err(res, 422, check.reason);
  const now = new Date().toISOString();
  db.prepare('UPDATE cases SET status=?, updated_at=? WHERE id=?').run(to, now, c.id);
  historyRow(c.id, c.status, to, req.user.sub, note);
  ok(res, { id: c.id, status: to });
});

// PATCH /cases/:id/assign
app.patch('/cases/:id/assign', authRequired, requireRole('SUPERVISOR', 'ADMIN'), (req, res) => {
  const { analyst_id } = req.body || {};
  if (!analyst_id) return err(res, 400, 'analyst_id gerekli');
  const c = db.prepare('SELECT * FROM cases WHERE id=?').get(req.params.id);
  if (!c) return err(res, 404, 'Vaka bulunamadı');
  const now = new Date().toISOString();
  db.prepare("UPDATE cases SET assigned_to=?, status=CASE WHEN status='YENI' THEN 'ATANDI' ELSE status END, updated_at=? WHERE id=?").run(analyst_id, now, c.id);
  historyRow(c.id, c.status, c.status === 'YENI' ? 'ATANDI' : c.status, req.user.sub, `Manuel atama -> ${analyst_id}`);
  ok(res, { id: c.id, assigned_to: analyst_id });
});

// PATCH /cases/:id/decision
app.patch('/cases/:id/decision', authRequired, requireRole('ANALYST', 'SUPERVISOR'), async (req, res) => {
  const { decision, fraud_type } = req.body || {};
  const note = sanitize(req.body && req.body.note, 1000);
  if (!['ONAYLANDI', 'BLOKLANDI'].includes(decision)) return err(res, 400, 'decision ONAYLANDI ya da BLOKLANDI olmalı');
  if (!note || note.trim().length < 3) return err(res, 400, 'Karar notu zorunlu');
  const validFraud = ['CALINTI_KART', 'HESAP_ELE_GECIRME', 'PARA_AKLAMA', 'SUPHELI_DAVRANIS', 'TEMIZ'];
  if (fraud_type && !validFraud.includes(fraud_type)) return err(res, 400, 'Geçersiz fraud_type');
  const c = db.prepare('SELECT * FROM cases WHERE id=?').get(req.params.id);
  if (!c) return err(res, 404, 'Vaka bulunamadı');
  if (req.user.role === 'ANALYST' && c.assigned_to !== req.user.sub) return err(res, 403, 'Bu vaka size atanmamış');
  if (c.status !== 'INCELENIYOR') return err(res, 422, 'Karar sadece INCELENIYOR durumundan verilebilir');

  const now = new Date().toISOString();
  db.prepare('UPDATE cases SET status=?, decision=?, decision_note=?, updated_at=? WHERE id=?').run(decision, decision, note, now, c.id);
  historyRow(c.id, 'INCELENIYOR', decision, req.user.sub, note);

  const t = db.prepare('SELECT * FROM transactions WHERE id=?').get(c.transaction_id);
  if (fraud_type && fraud_type !== t.fraud_type) {
    db.prepare('UPDATE transactions SET fraud_type=? WHERE id=?').run(fraud_type, t.id);
    // AI feedback for accuracy
    if (t.prediction_id) {
      try {
        await fetchJson(`${AI_URL}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Service-Token': SERVICE_TOKEN },
          body: JSON.stringify({ prediction_id: t.prediction_id, actual_type: fraud_type })
        });
      } catch (e) {}
    }
  }

  // Report to AI: decrement active_cases, update performance heuristic
  const wasCorrect = t.risk_score !== null && ((decision === 'BLOKLANDI' && t.risk_score >= 0.4) || (decision === 'ONAYLANDI' && t.risk_score < 0.4));
  if (c.assigned_to) reportAiDecision(c.assigned_to, wasCorrect);

  const decisionMs = new Date(now) - new Date(c.created_at);
  const slaMs = new Date(c.sla_deadline) - new Date(c.created_at);
  await notifyGamification('/events/case-decided', {
    case_id: c.id,
    analyst_id: c.assigned_to || req.user.sub,
    decision,
    fraud_type: fraud_type || t.fraud_type,
    risk_level: t.risk_level,
    decision_ms: decisionMs,
    sla_ms: slaMs,
    customer_confirmed_fraud: c.customer_verified === 'FRAUD'
  });

  ok(res, { id: c.id, status: decision, decision, decision_ms: decisionMs });
});

// Customer verification (called by customer or by system webhook)
app.post('/cases/:id/customer-verify', authRequired, requireRole('CUSTOMER'), (req, res) => {
  const { answer } = req.body || {};
  if (!['I_DID_IT', 'NOT_ME'].includes(answer)) return err(res, 400, "answer 'I_DID_IT' ya da 'NOT_ME' olmalı");
  const c = db.prepare('SELECT * FROM cases WHERE id=?').get(req.params.id);
  if (!c) return err(res, 404, 'Vaka bulunamadı');
  const t = db.prepare('SELECT * FROM transactions WHERE id=?').get(c.transaction_id);
  if (t.customer_id !== req.user.sub) return err(res, 403, 'Forbidden');
  if (c.status !== 'MUSTERI_DOGRULAMA') return err(res, 422, 'Doğrulama beklenmiyor');
  const now = new Date().toISOString();
  const verified = answer === 'NOT_ME' ? 'FRAUD' : 'LEGITIMATE';
  db.prepare("UPDATE cases SET customer_verified=?, status='INCELENIYOR', updated_at=? WHERE id=?").run(verified, now, c.id);
  historyRow(c.id, 'MUSTERI_DOGRULAMA', 'INCELENIYOR', req.user.sub, `Müşteri: ${answer}`);
  if (answer === 'NOT_ME' && t.risk_score !== null) {
    const bumped = Math.min(1, (t.risk_score || 0) + 0.1);
    db.prepare('UPDATE transactions SET risk_score=? WHERE id=?').run(bumped, t.id);
  }
  ok(res, { id: c.id, customer_verified: verified });
});

// Feedback after case CLOSED (rating 1-5)
app.post('/cases/:id/feedback', authRequired, requireRole('CUSTOMER'), async (req, res) => {
  const rating = Number(req.body && req.body.rating);
  if (!rating || rating < 1 || rating > 5) return err(res, 400, 'rating 1-5 olmalı');
  const c = db.prepare('SELECT * FROM cases WHERE id=?').get(req.params.id);
  if (!c) return err(res, 404, 'Vaka bulunamadı');
  const t = db.prepare('SELECT * FROM transactions WHERE id=?').get(c.transaction_id);
  if (t.customer_id !== req.user.sub) return err(res, 403, 'Forbidden');
  if (c.status !== 'KAPANDI') return err(res, 422, 'Vaka henüz kapanmadı');
  try {
    db.prepare('INSERT INTO customer_feedback (id, case_id, rating, created_at) VALUES (?,?,?,?)').run(uid(), c.id, rating, new Date().toISOString());
  } catch (e) { return err(res, 409, 'Zaten geri bildirim verildi'); }
  if (c.assigned_to) {
    await notifyGamification('/events/customer-feedback', { case_id: c.id, analyst_id: c.assigned_to, rating });
  }
  ok(res, { case_id: c.id, rating });
});

// Auto-close approved/blocked cases after 48h (called by cron)
app.post('/internal/tick-close', (req, res) => {
  if (req.headers['x-service-token'] !== SERVICE_TOKEN) return err(res, 401, 'Service token');
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const rows = db.prepare("SELECT id, status FROM cases WHERE status IN ('ONAYLANDI','BLOKLANDI') AND updated_at < ?").all(cutoff);
  const now = new Date().toISOString();
  for (const r of rows) {
    db.prepare("UPDATE cases SET status='KAPANDI', closed_at=?, updated_at=? WHERE id=?").run(now, now, r.id);
    historyRow(r.id, r.status, 'KAPANDI', 'SYSTEM', 'Otomatik 48h kapatma');
  }
  ok(res, { closed: rows.length });
});

// Dashboard
app.get('/dashboard', authRequired, requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const byType = db.prepare('SELECT fraud_type, COUNT(*) c FROM transactions WHERE fraud_type IS NOT NULL GROUP BY fraud_type').all();
  const byRisk = db.prepare('SELECT risk_level, COUNT(*) c FROM transactions WHERE risk_level IS NOT NULL GROUP BY risk_level').all();
  const openCases = db.prepare("SELECT COUNT(*) c FROM cases WHERE status NOT IN ('KAPANDI')").get().c;
  const belirsiz = db.prepare("SELECT COUNT(*) c FROM transactions WHERE risk_level='BELIRSIZ'").get().c;
  let ai_accuracy = null;
  try {
    const r = await fetch(`${AI_URL}/accuracy`);
    if (r.ok) ai_accuracy = (await r.json()).data;
  } catch (e) {}
  ok(res, { by_type: byType, by_risk: byRisk, open_cases: openCases, belirsiz_queue: belirsiz, ai_accuracy });
});

app.get('/dashboard/sla', authRequired, requireRole('SUPERVISOR', 'ADMIN'), (req, res) => {
  const now = new Date().toISOString();
  const active = db.prepare("SELECT id, transaction_id, status, sla_deadline, created_at FROM cases WHERE status NOT IN ('ONAYLANDI','BLOKLANDI','KAPANDI') ORDER BY sla_deadline ASC LIMIT 100").all();
  const total = db.prepare("SELECT COUNT(*) c FROM cases WHERE status IN ('ONAYLANDI','BLOKLANDI','KAPANDI')").get().c;
  const withinSla = db.prepare(`SELECT COUNT(*) c FROM cases WHERE status IN ('ONAYLANDI','BLOKLANDI','KAPANDI') AND updated_at <= sla_deadline`).get().c;
  const violations = active.filter(c => c.sla_deadline < now);
  ok(res, { sla_compliance: total > 0 ? Number((withinSla / total).toFixed(4)) : null, active, sla_violations: violations });
});

app.get('/dashboard/analytics', authRequired, requireRole('SUPERVISOR', 'ADMIN'), (req, res) => {
  const perAnalyst = db.prepare(`
    SELECT assigned_to as analyst_id, COUNT(*) c,
      SUM(CASE WHEN status IN ('ONAYLANDI','BLOKLANDI','KAPANDI') THEN 1 ELSE 0 END) decided,
      AVG(CASE WHEN status IN ('ONAYLANDI','BLOKLANDI','KAPANDI') THEN (julianday(updated_at) - julianday(created_at)) * 86400 * 1000 END) avg_ms
    FROM cases WHERE assigned_to IS NOT NULL GROUP BY assigned_to`).all();
  ok(res, { per_analyst: perAnalyst });
});

app.use((req, res) => err(res, 404, 'Not found'));

// SLA watcher: every 60s check unresolved cases past deadline, fire events, auto-block KRITIK,
// and auto-close cases that have been in ONAYLANDI/BLOKLANDI for 48h.
async function slaTick() {
  const now = new Date().toISOString();
  const active = db.prepare(`SELECT c.*, t.risk_level FROM cases c JOIN transactions t ON t.id=c.transaction_id
    WHERE c.status NOT IN ('ONAYLANDI','BLOKLANDI','KAPANDI') AND c.sla_deadline < ? AND c.sla_exceeded_at IS NULL`).all(now);
  for (const c of active) {
    db.prepare('UPDATE cases SET sla_exceeded_at=?, updated_at=? WHERE id=?').run(now, now, c.id);
    historyRow(c.id, c.status, c.status, 'SYSTEM', `SLA aşıldı (${c.risk_level})`);
    if (c.risk_level === 'KRITIK') {
      db.prepare("UPDATE transactions SET status='GECICI_BLOK' WHERE id=?").run(c.transaction_id);
      historyRow(c.id, c.status, c.status, 'SYSTEM', 'KRITIK SLA aşımı → geçici blok');
    }
    if (c.assigned_to) await notifyGamification('/events/sla-exceeded', { case_id: c.id, analyst_id: c.assigned_to });
  }
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const toClose = db.prepare("SELECT id, status FROM cases WHERE status IN ('ONAYLANDI','BLOKLANDI') AND updated_at < ?").all(cutoff);
  for (const r of toClose) {
    db.prepare("UPDATE cases SET status='KAPANDI', closed_at=?, updated_at=? WHERE id=?").run(now, now, r.id);
    historyRow(r.id, r.status, 'KAPANDI', 'SYSTEM', 'Otomatik 48h kapatma');
  }
}
setInterval(() => slaTick().catch(e => console.error('[sla]', e.message)), 60_000);

app.listen(PORT, () => console.log(`[transaction] listening :${PORT}`));
