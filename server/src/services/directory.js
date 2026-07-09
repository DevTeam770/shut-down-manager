// [INTEGRATION: closed-network] שליפת/אימות משתמשים מול Active Directory (LDAP).
//
// מצב נוכחי: רדום. פעיל רק כאשר LDAP_URL מוגדר ב-.env. עד אז המערכת עובדת
// עם משתמשים מקומיים בלבד וההתחברות אינה משתנה כלל.
//
// ── כדי להפעיל ברשת הסגורה (פעולות פשוטות): ──
//   1. הוסיפו תלות:  npm i ldapts -w server
//   2. מלאו ב-server/.env:  LDAP_URL, LDAP_BASE_DN, LDAP_UPN_SUFFIX  (ואופציונלי LDAP_REQUIRED_GROUP)
//   3. מְמַשׁוּ את גוף authenticateViaDirectory() לפי ה-TODO למטה (bind + search)
//   4. ריסטארט לשירות — מאותו רגע כל עובד נכנס עם שם המשתמש והסיסמא של הרשת.
//
// admin ולינור נשארים משתמשים מקומיים תמיד ⇦ אין סיכון להינעל בחוץ אם ה-DC לא זמין.

import db from '../db/db.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import logger from '../logger.js';

const url = process.env.LDAP_URL || '';
const baseDN = process.env.LDAP_BASE_DN || '';
const upnSuffix = process.env.LDAP_UPN_SUFFIX || '';
const requiredGroup = process.env.LDAP_REQUIRED_GROUP || '';

export const directoryEnabled = () => !!url;

// אימות מול הדומיין. מחזיר פרופיל { username, display_name, email } בהצלחה, אחרת null.
export async function authenticateViaDirectory(username, password) {
  if (!directoryEnabled()) return null;

  // [INTEGRATION: closed-network] TODO — מימוש בפועל מול ה-DC:
  //
  //   import { Client } from 'ldapts';
  //   const client = new Client({ url, tlsOptions: { rejectUnauthorized: false } });
  //   try {
  //     await client.bind(`${username}${upnSuffix}`, password);              // אימות סיסמת הדומיין
  //     const { searchEntries } = await client.search(baseDN, {
  //       scope: 'sub',
  //       filter: `(sAMAccountName=${username})`,
  //       attributes: ['displayName', 'mail', 'memberOf']
  //     });
  //     const e = searchEntries[0];
  //     if (!e) return null;
  //     if (requiredGroup && !([].concat(e.memberOf || [])).some(g => g.includes(requiredGroup))) return null;
  //     return { username, display_name: e.displayName || username, email: e.mail || '' };
  //   } catch { return null; }              // סיסמא שגויה / משתמש לא קיים
  //   finally { await client.unbind(); }
  //
  logger.warn('authenticateViaDirectory נקרא אך טרם מומש — ראו [INTEGRATION: closed-network] ב-directory.js');
  return null;
}

// יצירה/עדכון של משתמש מקומי מפרופיל AD (auto-provision). מסומן auth_source='ldap'.
export function provisionUser(profile) {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(profile.username);
  if (existing) {
    db.prepare('UPDATE users SET display_name = ?, email = ?, auth_source = ? WHERE id = ?')
      .run(profile.display_name, profile.email || existing.email, 'ldap', existing.id);
    return db.prepare('SELECT id, username, display_name, role, token_version FROM users WHERE id = ?').get(existing.id);
  }
  // סיסמא אקראית — משתמשי LDAP מתחברים דרך הדומיין, לא דרך הסיסמא המקומית
  const randomHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
  const info = db.prepare(
    `INSERT INTO users (username, password_hash, display_name, email, role, auth_source)
     VALUES (?, ?, ?, ?, 'user', 'ldap')`
  ).run(profile.username, randomHash, profile.display_name, profile.email || '');
  return db.prepare('SELECT id, username, display_name, role, token_version FROM users WHERE id = ?').get(info.lastInsertRowid);
}
