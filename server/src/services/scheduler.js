// משימות מתוזמנות (נקראות מדי דקה מ-index.js):
// 1. תזכורת יומית למי שטרם הגיב להשבתה
// 2. מעבר אוטומטי לסטטוס "בביצוע" בשעת ההתחלה + התראה כשעבר זמן הסיום
import db from '../db/db.js';
import config from '../config.js';
import logger from '../logger.js';
import { systemMessage, notifyUsers, groupMemberIds, emitActiveChanged } from './events.js';
import { fmtDate } from './shutdowns.js';

const pad = (n) => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// מניעת כפילות: האם כבר נשלחה למשתמש התראה כזו היום על ההשבתה הזו
function alreadyNotifiedToday(userId, shutdownId, kind) {
  return !!db.prepare(
    `SELECT 1 AS x FROM notifications
     WHERE user_id = ? AND shutdown_id = ? AND kind = ? AND date(created_at, 'localtime') = date('now', 'localtime')`
  ).get(userId, shutdownId, kind);
}

// תזכורות למי שטרם הגיב — רץ פעם ביום בשעה REMINDER_HOUR
export function runReminders() {
  const pending = db.prepare(
    `SELECT s.id, s.title, s.proposed_date, s.respond_by, s.group_id
     FROM shutdowns s
     WHERE s.status IN ('proposed', 'confirmed') AND s.is_final_date = 0
       AND s.proposed_date >= date('now', 'localtime')`
  ).all();

  let sent = 0;
  for (const s of pending) {
    const nonResponders = db.prepare(
      `SELECT m.user_id FROM group_members m
       WHERE m.group_id = ?
         AND NOT EXISTS(SELECT 1 FROM approvals a WHERE a.shutdown_id = ? AND a.user_id = m.user_id)`
    ).all(s.group_id, s.id).map(r => r.user_id);

    const overdue = s.respond_by && s.respond_by < todayStr();
    const deadline = s.respond_by
      ? (overdue ? ` — הדד-ליין לתגובה (${fmtDate(s.respond_by)}) עבר!` : ` — יש להגיב עד ${fmtDate(s.respond_by)}`)
      : '';

    for (const userId of nonResponders) {
      if (alreadyNotifiedToday(userId, s.id, 'reminder')) continue;
      notifyUsers([userId], {
        kind: 'reminder',
        body: `${overdue ? '🔴' : '⏰'} תזכורת: טרם הגבת להשבתה "${s.title}" בתאריך ${fmtDate(s.proposed_date)}${deadline}`,
        shutdownId: s.id,
        payload: { needs_response: true, title: s.title, proposed_date: s.proposed_date }
      });
      sent++;
    }
  }
  if (sent) logger.info({ sent }, 'נשלחו תזכורות למשתמשים שטרם הגיבו');
}

// מעברי סטטוס אוטומטיים — רץ כל דקה
export function runAutoTransitions() {
  const today = todayStr();
  const now = nowTime();

  // התחלה אוטומטית: השבתה מאושרת עם תאריך סופי, הגיעה שעת ההתחלה
  const starting = db.prepare(
    `SELECT id, title, start_time FROM shutdowns
     WHERE status = 'confirmed' AND is_final_date = 1
       AND proposed_date = ? AND start_time != '' AND start_time <= ?`
  ).all(today, now);
  for (const s of starting) {
    db.prepare(`UPDATE shutdowns SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`).run(s.id);
    systemMessage(s.id, `🔧 ההשבתה החלה אוטומטית (שעת ההתחלה ${s.start_time} הגיעה) — החדר פתוח לדיווחים שוטפים`);
    notifyUsers(groupMemberIds(s.id), {
      kind: 'status',
      body: `ההשבתה "${s.title}" החלה 🔧`,
      shutdownId: s.id
    });
    logger.info({ shutdown: s.id }, 'השבתה החלה אוטומטית');
  }
  if (starting.length) emitActiveChanged();

  // חריגה מזמן הסיום: התראה למנהלי הקבוצה (פעם ביום, לא סוגרים אוטומטית)
  const running = db.prepare(
    `SELECT id, title, group_id, proposed_date, start_time, end_time FROM shutdowns
     WHERE status = 'in_progress' AND end_time != ''`
  ).all();
  for (const s of running) {
    // end_time קטן משעת ההתחלה = ההשבתה נגמרת למחרת (למשל 22:00–02:00)
    const endsNextDay = s.start_time && s.end_time < s.start_time;
    const endDate = endsNextDay
      ? todayStr(new Date(new Date(s.proposed_date + 'T00:00').getTime() + 24 * 60 * 60 * 1000))
      : s.proposed_date;
    const isOverdue = endDate < today || (endDate === today && s.end_time < now);
    if (!isOverdue) continue;

    const managers = db.prepare(
      `SELECT user_id FROM group_members WHERE group_id = ? AND is_shutdown_manager = 1`
    ).all(s.group_id).map(r => r.user_id);
    for (const userId of managers) {
      if (alreadyNotifiedToday(userId, s.id, 'overdue_end')) continue;
      notifyUsers([userId], {
        kind: 'overdue_end',
        body: `⚠️ ההשבתה "${s.title}" עברה את שעת הסיום המתוכננת (${s.end_time}) וטרם נסגרה`,
        shutdownId: s.id
      });
    }
  }
}

// לולאת הדקה של המערכת — גיבוי, תזכורות ומעברים
let lastReminderDay = '';
export function minuteTick(backupFn) {
  const d = new Date();
  try {
    if (d.getHours() === config.backupHour && d.getMinutes() === 0) backupFn();
  } catch (e) { logger.error(e, 'גיבוי נכשל'); }
  try {
    if (d.getHours() === config.reminderHour && todayStr(d) !== lastReminderDay) {
      lastReminderDay = todayStr(d);
      runReminders();
    }
  } catch (e) { logger.error(e, 'שליחת תזכורות נכשלה'); }
  try {
    runAutoTransitions();
  } catch (e) { logger.error(e, 'מעברי סטטוס אוטומטיים נכשלו'); }
}
