const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'identity.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  gsm TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  region TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_specialties (
  user_id TEXT NOT NULL,
  specialty TEXT NOT NULL,
  PRIMARY KEY (user_id, specialty)
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  replaced_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  success INTEGER NOT NULL,
  ip TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_gsm ON users(gsm);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_specialties_user ON user_specialties(user_id);
`);

function uid() {
  return require('crypto').randomUUID();
}

function seed() {
  const row = db.prepare('SELECT COUNT(*) c FROM users').get();
  if (row.c > 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO users (id, first_name, last_name, gsm, email, password_hash, role, status, region, failed_attempts, created_at, updated_at)
    VALUES (@id,@first_name,@last_name,@gsm,@email,@password_hash,@role,'ACTIVE',@region,0,@created_at,@updated_at)`);
  const insSpec = db.prepare('INSERT OR IGNORE INTO user_specialties (user_id, specialty) VALUES (?, ?)');
  const hash = (p) => bcrypt.hashSync(p, 10);

  const admin = { id: uid(), first_name: 'Admin', last_name: 'User', gsm: null, email: 'admin@fraudcell.com', password_hash: hash('Admin!234'), role: 'ADMIN', region: 'MERKEZ', created_at: now, updated_at: now };
  const sup = { id: uid(), first_name: 'Suzan', last_name: 'Supervisor', gsm: null, email: 'supervisor@fraudcell.com', password_hash: hash('Super!234'), role: 'SUPERVISOR', region: 'MERKEZ', created_at: now, updated_at: now };
  const analyst1 = { id: uid(), first_name: 'Ali', last_name: 'Analyst', gsm: null, email: 'analyst1@fraudcell.com', password_hash: hash('Analyst!234'), role: 'ANALYST', region: 'ISTANBUL', created_at: now, updated_at: now };
  const analyst2 = { id: uid(), first_name: 'Ayse', last_name: 'Analyst', gsm: null, email: 'analyst2@fraudcell.com', password_hash: hash('Analyst!234'), role: 'ANALYST', region: 'ANKARA', created_at: now, updated_at: now };
  const cust = { id: uid(), first_name: 'Musteri', last_name: 'Bir', gsm: '5551112233', email: null, password_hash: null, role: 'CUSTOMER', region: 'ISTANBUL', created_at: now, updated_at: now };

  [admin, sup, analyst1, analyst2, cust].forEach(u => insert.run(u));
  insSpec.run(analyst1.id, 'CALINTI_KART');
  insSpec.run(analyst1.id, 'HESAP_ELE_GECIRME');
  insSpec.run(analyst2.id, 'PARA_AKLAMA');
  insSpec.run(analyst2.id, 'SUPHELI_DAVRANIS');
  console.log('[identity] seeded default users');
}
seed();

module.exports = { db, uid };
