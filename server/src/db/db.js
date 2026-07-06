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

// seed: משתמש admin ראשוני אם אין אף משתמש
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')`
  ).run('admin', hash, 'מנהל מערכת');
  logger.warn('נוצר משתמש admin ראשוני (admin / admin123) — יש להחליף סיסמא!');
}

export function audit(userId, action, entity, entityId, details = '') {
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, action, entity, entityId, typeof details === 'string' ? details : JSON.stringify(details));
}

// גיבוי DB עם VACUUM INTO — קובץ עקבי גם תוך כדי עבודה
export function backupDatabase() {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const target = path.join(config.backupDir, `shutdown-manager-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(target);
  // שמירת 14 גיבויים אחרונים בלבד
  const files = fs.readdirSync(config.backupDir).filter(f => f.endsWith('.db')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - 14))) {
    fs.unlinkSync(path.join(config.backupDir, old));
  }
  logger.info({ target }, 'גיבוי DB הושלם');
  return target;
}

export default db;
