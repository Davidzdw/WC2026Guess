PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS pools (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pool_settings (
  pool_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (pool_id, key),
  FOREIGN KEY (pool_id) REFERENCES pools(id)
);

INSERT OR IGNORE INTO pools (id, slug, name, created_at, updated_at, is_default)
VALUES (
  'pool_default',
  'main',
  COALESCE((SELECT value FROM settings WHERE key = 'appTitle' LIMIT 1), '2026 世界杯微信群竞猜'),
  '2026-06-16T00:00:00.000Z',
  '2026-06-16T00:00:00.000Z',
  1
);

INSERT OR IGNORE INTO pool_settings (pool_id, key, value)
VALUES
  ('pool_default', 'stakeAmount', COALESCE((SELECT value FROM settings WHERE key = 'stakeAmount' LIMIT 1), '10')),
  ('pool_default', 'lockMinutes', COALESCE((SELECT value FROM settings WHERE key = 'lockMinutes' LIMIT 1), '60')),
  ('pool_default', 'maxUsers', COALESCE((SELECT value FROM settings WHERE key = 'maxUsers' LIMIT 1), '50'));

CREATE TABLE users_new (
  pool_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (pool_id, id),
  FOREIGN KEY (pool_id) REFERENCES pools(id)
);

INSERT INTO users_new (pool_id, id, name, created_at, updated_at)
SELECT 'pool_default', id, name, created_at, updated_at
FROM users;

CREATE TABLE predictions_new (
  pool_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pick TEXT NOT NULL,
  pick_label TEXT NOT NULL,
  stake_amount REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (pool_id, match_id, user_id),
  FOREIGN KEY (pool_id, user_id) REFERENCES users_new(pool_id, id),
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

INSERT INTO predictions_new (pool_id, match_id, user_id, pick, pick_label, stake_amount, updated_at)
SELECT 'pool_default', match_id, user_id, pick, pick_label, stake_amount, updated_at
FROM predictions;

CREATE TABLE settlements_new (
  pool_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  settled_at TEXT NOT NULL,
  china_date TEXT NOT NULL,
  result TEXT,
  result_label TEXT,
  stake_amount REAL NOT NULL,
  score_text TEXT,
  status TEXT NOT NULL,
  void_reason TEXT,
  entries TEXT NOT NULL,
  PRIMARY KEY (pool_id, match_id),
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (pool_id) REFERENCES pools(id)
);

INSERT INTO settlements_new (pool_id, match_id, settled_at, china_date, result, result_label, stake_amount, score_text, status, void_reason, entries)
SELECT 'pool_default', match_id, settled_at, china_date, result, result_label, stake_amount, score_text, status, void_reason, entries
FROM settlements;

DROP TABLE predictions;
DROP TABLE settlements;
DROP TABLE users;

ALTER TABLE users_new RENAME TO users;
ALTER TABLE predictions_new RENAME TO predictions;
ALTER TABLE settlements_new RENAME TO settlements;

CREATE INDEX IF NOT EXISTS idx_users_pool_name ON users(pool_id, name);
CREATE INDEX IF NOT EXISTS idx_predictions_pool_user ON predictions(pool_id, user_id);
CREATE INDEX IF NOT EXISTS idx_predictions_pool_match ON predictions(pool_id, match_id);
CREATE INDEX IF NOT EXISTS idx_settlements_pool_date ON settlements(pool_id, china_date);

PRAGMA foreign_keys = ON;
