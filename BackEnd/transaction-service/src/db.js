const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'transaction.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  trx_number TEXT UNIQUE NOT NULL,
  customer_id TEXT NOT NULL,
  amount REAL NOT NULL,
  type TEXT NOT NULL,
  receiver TEXT,
  device TEXT,
  city TEXT,
  status TEXT NOT NULL,
  risk_score REAL,
  risk_level TEXT,
  fraud_type TEXT,
  prediction_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  assigned_to TEXT,
  status TEXT NOT NULL,
  decision TEXT,
  decision_note TEXT,
  sla_deadline TEXT,
  sla_exceeded_at TEXT,
  customer_verified TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS case_history (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  performed_by TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_feedback (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  rating INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trx_counter (
  year INTEGER PRIMARY KEY,
  counter INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trx_customer_created ON transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trx_risk_level ON transactions(risk_level);
CREATE INDEX IF NOT EXISTS idx_trx_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_cases_assigned ON cases(assigned_to, sla_deadline);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_sla ON cases(sla_deadline);
CREATE INDEX IF NOT EXISTS idx_history_case ON case_history(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency(created_at);
`);

// Column migrations for pre-existing DBs
function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
ensureColumn('cases', 'sla_exceeded_at', 'TEXT');

function nextTrxNumber() {
  const year = new Date().getUTCFullYear();
  const tx = db.transaction(() => {
    let row = db.prepare('SELECT counter FROM trx_counter WHERE year=?').get(year);
    if (!row) {
      db.prepare('INSERT INTO trx_counter (year, counter) VALUES (?, 1)').run(year);
      return 1;
    }
    const next = row.counter + 1;
    db.prepare('UPDATE trx_counter SET counter=? WHERE year=?').run(next, year);
    return next;
  });
  const n = tx();
  return `TRX-${year}-${String(n).padStart(6, '0')}`;
}

module.exports = { db, uid: () => require('crypto').randomUUID(), nextTrxNumber };
