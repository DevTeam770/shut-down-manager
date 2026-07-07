-- מערכת ניהול השבתות - סכמת מסד נתונים
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_shutdown_manager INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS shutdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  proposed_date TEXT NOT NULL,          -- YYYY-MM-DD
  start_time TEXT DEFAULT '',           -- HH:MM
  end_time TEXT DEFAULT '',             -- HH:MM
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  is_final_date INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shutdowns_group ON shutdowns(group_id);
CREATE INDEX IF NOT EXISTS idx_shutdowns_date ON shutdowns(proposed_date);
CREATE INDEX IF NOT EXISTS idx_shutdowns_status ON shutdowns(status);

CREATE TABLE IF NOT EXISTS approvals (
  shutdown_id INTEGER NOT NULL REFERENCES shutdowns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response TEXT NOT NULL CHECK (response IN ('approved', 'rejected', 'conditional')),
  condition_text TEXT DEFAULT '',
  alternative_date TEXT DEFAULT '',     -- הצעת תאריך חלופי YYYY-MM-DD
  condition_resolved INTEGER NOT NULL DEFAULT 0,
  responded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (shutdown_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shutdown_id INTEGER NOT NULL REFERENCES shutdowns(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),  -- NULL להודעות מערכת
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'system')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_shutdown ON messages(shutdown_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shutdown_id INTEGER REFERENCES shutdowns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                   -- new_shutdown / date_changed / date_final / response / resolved / status / review
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS shutdown_reviews (
  shutdown_id INTEGER PRIMARY KEY REFERENCES shutdowns(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  score INTEGER CHECK (score BETWEEN 1 AND 10),
  lessons TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shutdown_id INTEGER NOT NULL REFERENCES shutdowns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,          -- השם שהמשתמש העלה (מוצג בלבד)
  stored_name TEXT NOT NULL,            -- שם אקראי בדיסק
  mime TEXT DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_shutdown ON attachments(shutdown_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,                 -- shutdown / group / user
  entity_id INTEGER,
  details TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
