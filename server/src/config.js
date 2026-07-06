import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// קונפיגורציה בקובץ אחד — config.json ליד השרת. נוצר אוטומטית בהרצה ראשונה.
const configPath = process.env.CONFIG_PATH || path.join(rootDir, 'config.json');

const defaults = {
  port: 3000,
  dbPath: path.join(rootDir, 'data', 'shutdown-manager.db'),
  backupDir: path.join(rootDir, 'data', 'backups'),
  jwtSecret: '', // נוצר אוטומטית אם ריק
  jwtExpiresDays: 7,
  logDir: path.join(rootDir, 'logs'),
  backupHour: 2 // שעת גיבוי לילי
};

let fileConfig = {};
if (fs.existsSync(configPath)) {
  fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

const config = { ...defaults, ...fileConfig };

// יצירת סוד JWT קבוע בהרצה ראשונה ושמירתו בקובץ הקונפיגורציה
if (!config.jwtSecret) {
  config.jwtSecret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(configPath, JSON.stringify({ ...fileConfig, jwtSecret: config.jwtSecret }, null, 2));
}

// תמיכה בדריסה דרך משתני סביבה (לבדיקות/פריסה)
if (process.env.PORT) config.port = Number(process.env.PORT);
if (process.env.DB_PATH) config.dbPath = process.env.DB_PATH;

for (const dir of [path.dirname(config.dbPath), config.backupDir, config.logDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

export default config;
