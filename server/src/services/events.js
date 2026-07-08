// גשר בין הלוגיקה העסקית ל-Socket.IO:
// הודעות מערכת בצ'אט + התראות קופצות, עם התמדה ב-DB לפני שידור.
import db from '../db/db.js';
import { mailUsers } from './mailer.js';

// סוגי התראות שנשלחים גם במייל (כשה-SMTP מוגדר)
const MAIL_KINDS = {
  new_shutdown: 'השבתה חדשה — נדרשת תגובתך',
  date_changed: 'תאריך השבתה עודכן — נדרשת תגובתך',
  date_final: 'תאריך השבתה נקבע סופית',
  reminder: 'תזכורת: טרם הגבת להשבתה'
};

let io = null;
export function setIo(instance) { io = instance; }

// הודעת מערכת בחדר הצ'אט של השבתה (נשמרת ב-DB ואז משודרת)
export function systemMessage(shutdownId, body) {
  const info = db.prepare(
    `INSERT INTO messages (shutdown_id, user_id, body, type) VALUES (?, NULL, ?, 'system')`
  ).run(shutdownId, body);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  io?.to(`shutdown:${shutdownId}`).emit('chat:message', { ...message, display_name: 'מערכת' });
  return message;
}

// התראה למשתמשים ספציפיים — נשמרת ב-DB ומשודרת לערוץ האישי של כל משתמש
export function notifyUsers(userIds, { kind, body, shutdownId = null, payload = {} }) {
  const insert = db.prepare(
    'INSERT INTO notifications (user_id, shutdown_id, kind, body) VALUES (?, ?, ?, ?)'
  );
  for (const userId of userIds) {
    const info = insert.run(userId, shutdownId, kind, body);
    io?.to(`user:${userId}`).emit('notify', {
      id: Number(info.lastInsertRowid),
      user_id: userId,
      shutdown_id: shutdownId,
      kind,
      body,
      created_at: new Date().toISOString(),
      ...payload
    });
  }
  // מייל במקביל להתראה — רק לסוגים החשובים, ורק אם SMTP מוגדר
  if (MAIL_KINDS[kind]) mailUsers(userIds, MAIL_KINDS[kind], body);
}

// כל חברי הקבוצה של השבתה, אופציונלית למעט משתמש (בד"כ מבצע הפעולה)
export function groupMemberIds(shutdownId, exceptUserId = null) {
  const rows = db.prepare(
    `SELECT m.user_id FROM group_members m
     JOIN shutdowns s ON s.group_id = m.group_id WHERE s.id = ?`
  ).all(shutdownId);
  return rows.map(r => r.user_id).filter(id => id !== exceptUserId);
}

// עדכון חי של מצב ההשבתה לכל מי שצופה בדף שלה
export function emitShutdownUpdate(shutdownId) {
  io?.to(`shutdown:${shutdownId}`).emit('shutdown:updated', { id: shutdownId });
}

// טריגר גלובלי לרענון באנר "השבתה בביצוע" — לכל המחוברים, כולל מבצע הפעולה.
// לא נושא מידע; הקליינט מושך active-now שמסונן הרשאות בשרת.
export function emitActiveChanged() {
  io?.emit('active:changed');
}
