// SQLite מובנה ב-Node (>=22.13) — אפס תלויות native, אידיאלי לרשת סגורה
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import config from '../config.js';
import logger from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = new DatabaseSync(config.dbPath, { enableForeignKeyConstraints: true });
db.exec('PRAGMA journal_mode = WAL;');

// יצירת סכמה
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// מיגרציות ל-DB קיים — הוספת עמודות שנוספו אחרי גרסה 1.0
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    logger.info(`מיגרציה: נוספה עמודה ${table}.${column}`);
  }
}
ensureColumn('users', 'token_version', `token_version INTEGER NOT NULL DEFAULT 0`);
ensureColumn('users', 'email', `email TEXT DEFAULT ''`);
ensureColumn('shutdowns', 'respond_by', `respond_by TEXT DEFAULT ''`);
ensureColumn('shutdowns', 'doc_sent', `doc_sent INTEGER NOT NULL DEFAULT 0`);
ensureColumn('approvals', 'impact_text', `impact_text TEXT DEFAULT ''`);      // משמעות ברמת המחלקה
ensureColumn('approvals', 'impact_general', `impact_general TEXT DEFAULT ''`); // משמעות כללית על כלל המערכת
ensureColumn('checklist_items', 'admin_only', `admin_only INTEGER NOT NULL DEFAULT 0`);
ensureColumn('messages', 'recipient_id', `recipient_id INTEGER`); // NULL=לכולם; אחרת הודעה פרטית
ensureColumn('users', 'auth_source', `auth_source TEXT NOT NULL DEFAULT 'local'`); // local / ldap (רשת סגורה)

// seed: משתמש admin ראשוני אם אין אף משתמש
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')`
  ).run('admin', hash, 'מנהל מערכת');
  logger.warn('נוצר משתמש admin ראשוני (admin / admin123) — יש להחליף סיסמא!');
}

// יצירה חד-פעמית של לינור — מנהלת מערכת (admin)
if (!db.prepare('SELECT id FROM users WHERE username = ?').get('Linor')) {
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')`
  ).run('Linor', bcrypt.hashSync('Linor123', 10), 'לינור');
  logger.warn('נוצרה משתמשת Linor (Linor / Linor123) — מנהלת מערכת. יש להחליף סיסמא!');
}

export function audit(userId, action, entity, entityId, details = '') {
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, action, entity, entityId, typeof details === 'string' ? details : JSON.stringify(details));
}

// גיבוי DB עם VACUUM INTO — קובץ עקבי גם תוך כדי עבודה + העתקת קבצים מצורפים
export function backupDatabase() {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const target = path.join(config.backupDir, `shutdown-manager-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(target);
  // שמירת 14 גיבויים אחרונים בלבד
  const files = fs.readdirSync(config.backupDir).filter(f => f.endsWith('.db')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - 14))) {
    fs.unlinkSync(path.join(config.backupDir, old));
  }
  // הקבצים המצורפים ונהלי ההשבתות מסונכרנים לעותק יחיד (רק נוספים/נמחקים)
  for (const [src, name] of [[config.uploadDir, 'uploads'], [config.procedureDir, 'procedures']]) {
    if (src && fs.existsSync(src)) {
      fs.cpSync(src, path.join(config.backupDir, name), { recursive: true, force: true });
    }
  }
  logger.info({ target }, 'גיבוי DB וקבצים הושלם');
  return target;
}

export default db;
