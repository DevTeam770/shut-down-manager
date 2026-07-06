// אריזת המערכת לפריסה ברשת סגורה:
//   npm run package
// מייצר תיקיית dist-deploy/ עצמאית לחלוטין — מעתיקים אותה לשרת היעד (נדרש רק Node.js)
// ומריצים start.bat. אפס קריאות רשת בזמן ריצה.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deploy = path.join(root, 'dist-deploy');

function run(cmd, cwd = root) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

console.log('=== אריזת מערכת ניהול השבתות לרשת סגורה ===');

// 1. build של הקליינט
run('npm run build -w client');

// 2. בדיקת אפס-קריאות-חיצוניות על ה-build.
// דומיינים שמופיעים רק כמחרוזות תיעוד בהודעות שגיאה של ספריות (לא קריאות רשת):
const BENIGN = ['www.w3.org', 'reactjs.org', 'react.dev', 'reactrouter.com', 'socket.io', 'www.gnu.org', 'www.hebcal.com', 'localhost', 'github.com'];
const distAssets = path.join(root, 'client', 'dist');
const externalRefs = [];
for (const file of fs.readdirSync(path.join(distAssets, 'assets'))) {
  if (!/\.(js|css)$/.test(file)) continue;
  const content = fs.readFileSync(path.join(distAssets, 'assets', file), 'utf8');
  const matches = content.match(/https?:\/\/[a-z0-9.-]+/gi) || [];
  for (const m of matches) {
    const host = m.replace(/^https?:\/\//i, '');
    if (!BENIGN.includes(host)) externalRefs.push(`${file}: ${m}`);
  }
}
if (externalRefs.length) {
  console.error('\n❌ נמצאו הפניות לכתובות חיצוניות ב-build:');
  for (const r of [...new Set(externalRefs)]) console.error('   ' + r);
  process.exit(1);
}
console.log('✅ בדיקת אפס-קריאות-חיצוניות עברה');

// 3. מבנה התיקייה
fs.rmSync(deploy, { recursive: true, force: true });
fs.mkdirSync(path.join(deploy, 'server'), { recursive: true });
fs.mkdirSync(path.join(deploy, 'client'), { recursive: true });

fs.cpSync(path.join(root, 'server', 'src'), path.join(deploy, 'server', 'src'), { recursive: true });
fs.cpSync(path.join(root, 'client', 'dist'), path.join(deploy, 'client', 'dist'), { recursive: true });

// package.json של production בלבד (ללא devDependencies וללא סקריפטי dev)
const serverPkg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'));
delete serverPkg.devDependencies;
serverPkg.scripts = { start: serverPkg.scripts.start };
fs.writeFileSync(path.join(deploy, 'server', 'package.json'), JSON.stringify(serverPkg, null, 2));

// 4. התקנת תלויות production בתוך החבילה (כולן JS טהור — עובדות בכל מכונה עם Node)
run('npm install --omit=dev --no-audit --no-fund --ignore-scripts', path.join(deploy, 'server'));
fs.rmSync(path.join(deploy, 'server', 'package-lock.json'), { force: true });

// 5. סקריפטי הפעלה
fs.writeFileSync(path.join(deploy, 'start.bat'),
  '@echo off\r\n' +
  'cd /d "%~dp0server"\r\n' +
  'node --disable-warning=ExperimentalWarning src/index.js\r\n');

fs.writeFileSync(path.join(deploy, 'install-service.bat'),
  '@echo off\r\n' +
  'REM התקנה כ-Windows Service באמצעות NSSM (יש להוריד nssm.exe ולהניח ליד הקובץ הזה)\r\n' +
  'set DIR=%~dp0\r\n' +
  '"%DIR%nssm.exe" install ShutdownManager "%ProgramFiles%\\nodejs\\node.exe" "--disable-warning=ExperimentalWarning src/index.js"\r\n' +
  '"%DIR%nssm.exe" set ShutdownManager AppDirectory "%DIR%server"\r\n' +
  '"%DIR%nssm.exe" set ShutdownManager DisplayName "Shutdown Manager"\r\n' +
  '"%DIR%nssm.exe" set ShutdownManager Start SERVICE_AUTO_START\r\n' +
  '"%DIR%nssm.exe" start ShutdownManager\r\n' +
  'echo Service installed.\r\n');

fs.writeFileSync(path.join(deploy, 'README-DEPLOY.txt'),
`מערכת ניהול השבתות — הוראות פריסה ברשת סגורה
=============================================

דרישה יחידה בשרת היעד: Node.js 22.13 ומעלה (מומלץ 24).

פריסה:
1. העתיקו את כל התיקייה הזו (dist-deploy) לשרת היעד.
2. הפעלה ידנית: לחיצה כפולה על start.bat (ברירת מחדל: http://localhost:3000)
3. הפעלה כשירות Windows (מומלץ): הניחו nssm.exe בתיקייה והריצו install-service.bat כמנהל.

קונפיגורציה: server/config.json (נוצר אוטומטית בהרצה ראשונה)
  port       - פורט ההאזנה (ברירת מחדל 3000)
  dbPath     - נתיב קובץ מסד הנתונים
  backupDir  - תיקיית גיבויים (גיבוי לילי אוטומטי, נשמרים 14 אחרונים)
  backupHour - שעת הגיבוי הלילי (ברירת מחדל 02:00)

משתמש ראשוני: admin / admin123 — חובה להחליף סיסמא בכניסה הראשונה!

גיבוי ידני: העתקת הקובץ ב-dbPath (או תיקיית הגיבויים) למקום בטוח.
בריאות המערכת: GET /api/health
לוגים: server/logs/server.log
`);

console.log(`\n✅ החבילה מוכנה: ${deploy}`);
console.log('   העתיקו את התיקייה לשרת ברשת הסגורה והריצו start.bat');
