import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// קונפיגורציה בקובץ server/.env (נוצר אוטומטית בהרצה ראשונה מתוך .env.example)
const envPath = process.env.ENV_FILE || path.join(rootDir, '.env');

// טעינת .env — משתני סביבה חיצוניים גוברים על הקובץ
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

// יצירת סוד JWT קבוע בהרצה ראשונה ושמירתו ב-.env
if (!process.env.JWT_SECRET) {
  const secret = crypto.randomBytes(48).toString('hex');
  fs.appendFileSync(envPath, `${fs.existsSync(envPath) ? '\n' : ''}JWT_SECRET=${secret}\n`);
  process.env.JWT_SECRET = secret;
}

// המרה מספרית שמכבדת 0 כערך תקין (למשל PORT=0 לפורט אקראי, BACKUP_HOUR=0 לחצות)
const num = (v, def) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : def);

const config = {
  port: num(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH || path.join(rootDir, 'data', 'shutdown-manager.db'),
  backupDir: process.env.BACKUP_DIR || path.join(rootDir, 'data', 'backups'),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresDays: num(process.env.JWT_EXPIRES_DAYS, 7),
  logDir: process.env.LOG_DIR || path.join(rootDir, 'logs'),
  backupHour: num(process.env.BACKUP_HOUR, 2) // שעת גיבוי לילי
};

for (const dir of [path.dirname(config.dbPath), config.backupDir, config.logDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

export default config;
