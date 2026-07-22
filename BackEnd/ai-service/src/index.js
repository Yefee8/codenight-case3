const express = require('express');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const yaml = require('yamljs');
const { db, uid } = require('./db');
const { score, MODEL_VERSION } = require('./scoring');
const { securityHeaders, correlationId, requireJsonContent } = require('./security');

const openapiSpec = yaml.load(path.join(__dirname, 'openapi.yaml'));

const PORT = process.env.PORT || 3003;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 'dev-service-token';
const IDENTITY_URL = process.env.IDENTITY_URL || 'http://identity:3001';

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

const SPECIALTY_MAP = {
  CALINTI_KART: 'CALINTI_KART',
  HESAP_ELE_GECIRME: 'HESAP_ELE_GECIRME',
  PARA_AKLAMA: 'PARA_AKLAMA',
  SUPHELI_DAVRANIS: 'SUPHELI_DAVRANIS',
  TEMIZ: null
};
const CAPACITY = 10;

app.get('/health', (req, res) => ok(res, { service: 'ai', status: 'up', model: MODEL_VERSION }));
app.get('/openapi.json', (req, res) => res.json(openapiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: 'FraudCell AI API' }));

app.post('/score', serviceOnly, (req, res) => {
  const { transaction_id, ...input } = req.body || {};
  if (!transaction_id) return err(res, 400, 'transaction_id gerekli');
  const result = score(input);
  const id = uid();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO predictions (id, transaction_id, risk_score, risk_level, fraud_type, decision, model_version, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, transaction_id, result.risk_score, result.risk_level, result.fraud_type, result.decision, result.model_version, now);
  ok(res, { prediction_id: id, ...result });
});

app.post('/assign', serviceOnly, async (req, res) => {
  const { case_id, fraud_type } = req.body || {};
  if (!case_id || !fraud_type) return err(res, 400, 'case_id ve fraud_type gerekli');
  try {
    const r = await fetch(`${IDENTITY_URL}/internal/analysts`, { headers: { 'X-Service-Token': SERVICE_TOKEN } });
    if (!r.ok) return err(res, 503, 'Identity servisine ulaşılamıyor');
    const j = await r.json();
    const analysts = j.data || [];
    if (analysts.length === 0) return ok(res, { analyst_id: null, reason: 'ANALIST_YOK' });

    const desiredSpec = SPECIALTY_MAP[fraud_type];
    let best = null;
    let bestScore = -1;
    for (const a of analysts) {
      const stats = db.prepare('SELECT * FROM analyst_stats WHERE analyst_id=?').get(a.id) || { active_cases: 0, total_decisions: 0, correct_decisions: 0 };
      if (stats.active_cases >= CAPACITY) continue;
      const uzmanlik = (desiredSpec && a.specialties && a.specialties.includes(desiredSpec)) ? 1 : 0;
      const bosluk = 1 - (stats.active_cases / CAPACITY);
      const performans = stats.total_decisions > 0 ? stats.correct_decisions / stats.total_decisions : 0.5;
      const s = uzmanlik * 0.5 + bosluk * 0.3 + performans * 0.2;
      if (s > bestScore) { bestScore = s; best = a; }
    }
    if (!best) return ok(res, { analyst_id: null, reason: 'KAPASITE_YOK' });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO analyst_stats (analyst_id, active_cases, total_decisions, correct_decisions, updated_at)
      VALUES (?, 1, 0, 0, ?)
      ON CONFLICT(analyst_id) DO UPDATE SET active_cases = active_cases + 1, updated_at = excluded.updated_at`).run(best.id, now);
    ok(res, { analyst_id: best.id, score: Number(bestScore.toFixed(4)) });
  } catch (e) {
    console.error(e);
    err(res, 500, 'Atama başarısız');
  }
});

app.post('/decisions', serviceOnly, (req, res) => {
  const { analyst_id, correct } = req.body || {};
  if (!analyst_id) return err(res, 400, 'analyst_id gerekli');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO analyst_stats (analyst_id, active_cases, total_decisions, correct_decisions, updated_at)
    VALUES (?, 0, 1, ?, ?)
    ON CONFLICT(analyst_id) DO UPDATE SET
      active_cases = MAX(active_cases - 1, 0),
      total_decisions = total_decisions + 1,
      correct_decisions = correct_decisions + ?,
      updated_at = excluded.updated_at`).run(analyst_id, correct ? 1 : 0, now, correct ? 1 : 0);
  ok(res, { updated: true });
});

app.post('/feedback', serviceOnly, (req, res) => {
  const { prediction_id, actual_type } = req.body || {};
  if (!prediction_id || !actual_type) return err(res, 400, 'prediction_id ve actual_type gerekli');
  const p = db.prepare('SELECT * FROM predictions WHERE id=?').get(prediction_id);
  if (!p) return err(res, 404, 'Prediction bulunamadı');
  const correct = p.fraud_type === actual_type ? 1 : 0;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO prediction_feedback (id, prediction_id, predicted_type, actual_type, correct, created_at)
    VALUES (?,?,?,?,?,?)`).run(uid(), prediction_id, p.fraud_type, actual_type, correct, now);
  ok(res, { correct: !!correct });
});

app.get('/accuracy', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c, SUM(correct) s FROM prediction_feedback').get();
  const overall = total.c > 0 ? (total.s || 0) / total.c : null;
  const byCat = db.prepare('SELECT predicted_type, COUNT(*) c, SUM(correct) s FROM prediction_feedback GROUP BY predicted_type').all();
  ok(res, {
    overall_accuracy: overall === null ? null : Number(overall.toFixed(4)),
    total_feedback: total.c,
    by_category: byCat.map(r => ({ fraud_type: r.predicted_type, accuracy: r.c > 0 ? Number(((r.s || 0) / r.c).toFixed(4)) : null, count: r.c }))
  });
});

app.use((req, res) => err(res, 404, 'Not found'));

app.listen(PORT, () => console.log(`[ai] listening :${PORT}`));
