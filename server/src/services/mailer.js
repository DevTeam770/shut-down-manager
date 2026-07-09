// [INTEGRATION: closed-network] שליחת מייל דרך שרת SMTP פנימי (Exchange).
// מופעל רק כש-SMTP_HOST מוגדר ב-.env. ללא קונפיגורציה: no-op שקט, והמערכת
// עובדת רגיל עם התראות באתר בלבד. הפעלה = מילוי SMTP_HOST/PORT/FROM ב-.env בלבד.
import nodemailer from 'nodemailer';
import db from '../db/db.js';
import logger from '../logger.js';

const host = process.env.SMTP_HOST || '';
const port = Number(process.env.SMTP_PORT) || 25;
const from = process.env.SMTP_FROM || 'shutdown-manager@local';

let transport = null;
if (host) {
  transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    // Exchange פנימי בד"כ מקבל relay אנונימי; אם לא — SMTP_USER/PASS
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
    tls: { rejectUnauthorized: false } // תעודות self-signed נפוצות ברשת סגורה
  });
  logger.info({ host, port }, 'שליחת מיילים פעילה (SMTP)');
}

export const mailEnabled = () => !!transport;

// שליחה לרשימת משתמשים לפי id — רק למי שיש כתובת מייל
export function mailUsers(userIds, subject, body) {
  if (!transport || !userIds.length) return;
  const placeholders = userIds.map(() => '?').join(',');
  const recipients = db.prepare(
    `SELECT email FROM users WHERE id IN (${placeholders}) AND email != ''`
  ).all(...userIds).map(r => r.email);
  if (!recipients.length) return;

  transport.sendMail({
    from,
    bcc: recipients, // bcc — שלא יראו זה את זה
    subject: `[ניהול השבתות] ${subject}`,
    text: body
  }).catch(err => logger.error({ err: err.message }, 'שליחת מייל נכשלה'));
}
