const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'gamification.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS points (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  point INTEGER NOT NULL,
  reason TEXT NOT NULL,
  case_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);
CREATE TABLE IF NOT EXISTS user_stats (
  user_id TEXT PRIMARY KEY,
  total_cases INTEGER NOT NULL DEFAULT 0,
  fraud_confirmed INTEGER NOT NULL DEFAULT 0,
  wrong_blocks INTEGER NOT NULL DEFAULT 0,
  fast_decisions INTEGER NOT NULL DEFAULT 0,
  critical_solved INTEGER NOT NULL DEFAULT 0,
  by_type TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS customer_feedback_events (
  id TEXT PRIMARY KEY,
  analyst_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points_user_created ON points(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_points_created ON points(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_badges_user ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user_seen ON notifications(user_id, seen);
CREATE INDEX IF NOT EXISTS idx_cf_analyst ON customer_feedback_events(analyst_id);
`);

const seedBadges = [
  { code: 'ILK_YAKALAMA', name: 'İlk Yakalama', description: 'İlk dolandırıcılık vakasını çözme' },
  { code: 'KESKIN_GOZ', name: 'Keskin Göz', description: '15 dakikanın altında 10 vaka kararı' },
  { code: 'SIFIR_HATA', name: 'Sıfır Hata', description: '50 vakada hiç yanlış pozitif olmadan' },
  { code: 'MARATONCU', name: 'Maratoncu', description: 'Bir günde 20 vaka kararı' },
  { code: 'KRIZ_YONETICISI', name: 'Kriz Yöneticisi', description: '10 KRİTİK vakayı SLA içinde çözme' },
  { code: 'UZMAN_AVCI', name: 'Uzman Avcı', description: 'Tek türde 50 dolandırıcılık yakalama' }
];
const bIns = db.prepare('INSERT OR IGNORE INTO badges (id, code, name, description) VALUES (?,?,?,?)');
seedBadges.forEach(b => bIns.run(require('crypto').randomUUID(), b.code, b.name, b.description));

module.exports = { db, uid: () => require('crypto').randomUUID() };
