const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'ai.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  risk_score REAL NOT NULL,
  risk_level TEXT NOT NULL,
  fraud_type TEXT NOT NULL,
  decision TEXT NOT NULL,
  model_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prediction_feedback (
  id TEXT PRIMARY KEY,
  prediction_id TEXT NOT NULL,
  predicted_type TEXT NOT NULL,
  actual_type TEXT NOT NULL,
  correct INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analyst_stats (
  analyst_id TEXT PRIMARY KEY,
  active_cases INTEGER NOT NULL DEFAULT 0,
  total_decisions INTEGER NOT NULL DEFAULT 0,
  correct_decisions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_predictions_trx ON predictions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_predictions_created ON predictions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_prediction ON prediction_feedback(prediction_id);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON prediction_feedback(predicted_type);
`);

module.exports = { db, uid: () => require('crypto').randomUUID() };
