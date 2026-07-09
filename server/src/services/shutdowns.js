// לוגיקה עסקית של השבתות: שליפות מועשרות, מעברי סטטוס, סבבי אישור
import db from '../db/db.js';

export const STATUS_LABELS = {
  proposed: 'מוצעת',
  confirmed: 'מאושרת',
  in_progress: 'בביצוע',
  completed: 'הסתיימה',
  cancelled: 'בוטלה'
};

// מעברי סטטוס חוקיים
const TRANSITIONS = {
  proposed: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'proposed', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isChatOpen(status) {
  return status !== 'completed' && status !== 'cancelled';
}

// שליפת השבתה עם כל ההקשר: קבוצה, יוצר, אישורים, סיכום.
// viewerRole — כשאינו 'admin': פריטי צ'קליסט פרטיים (admin_only) מסוננים,
//   וכן ציונים/דוחות (סיכום, משוב משתתפים, ממוצע) — הנהלה בלבד; משתמש רגיל רואה רק את המשוב שלו.
export function getShutdownFull(id, viewerRole = 'admin', viewerId = null) {
  const isAdmin = viewerRole === 'admin';
  const shutdown = db.prepare(
    `SELECT s.*, g.name AS group_name, u.display_name AS created_by_name
     FROM shutdowns s JOIN groups g ON g.id = s.group_id JOIN users u ON u.id = s.created_by
     WHERE s.id = ?`
  ).get(id);
  if (!shutdown) return null;

  const approvals = db.prepare(
    `SELECT a.*, u.display_name FROM approvals a JOIN users u ON u.id = a.user_id
     WHERE a.shutdown_id = ? ORDER BY a.responded_at`
  ).all(id);

  const members = db.prepare(
    `SELECT u.id, u.display_name, m.is_shutdown_manager FROM group_members m
     JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.display_name`
  ).all(shutdown.group_id);

  // ציון הסיכום — הנהלה (admin) בלבד
  const review = isAdmin
    ? (db.prepare('SELECT * FROM shutdown_reviews WHERE shutdown_id = ?').get(id) || null)
    : null;

  const checklist = db.prepare(
    `SELECT c.*, u.display_name AS done_by_name FROM checklist_items c
     LEFT JOIN users u ON u.id = c.done_by
     WHERE c.shutdown_id = ? ${viewerRole === 'admin' ? '' : 'AND c.admin_only = 0'}
     ORDER BY c.phase, c.position, c.id`
  ).all(id);

  // משוב המשתתפים והממוצע — הנהלה בלבד; משתמש רגיל מקבל רק את שורת המשוב שלו (לטעינת הטופס), בלי ממוצע.
  const allFeedback = db.prepare(
    `SELECT f.*, u.display_name FROM participant_feedback f JOIN users u ON u.id = f.user_id
     WHERE f.shutdown_id = ? ORDER BY f.created_at`
  ).all(id);
  const feedback = isAdmin ? allFeedback : allFeedback.filter(f => f.user_id === viewerId);
  const avgFeedback = isAdmin && allFeedback.length
    ? Math.round((allFeedback.reduce((s, f) => s + f.score, 0) / allFeedback.length) * 10) / 10
    : null;

  return {
    ...shutdown,
    approvals,
    members,
    review,
    checklist,
    feedback,
    avg_feedback: avgFeedback,
    pending_count: members.length - approvals.length,
    approved_count: approvals.filter(a => a.response === 'approved').length
  };
}

// אישור אוטומטי ליוזם ההשבתה — הוא הציע את התאריך ולכן פטור מאישור עצמי.
// חל רק אם היוצר חבר בקבוצה (אחרת אינו נספר ממילא).
export function autoApproveCreator(shutdownId) {
  const s = db.prepare('SELECT created_by, group_id FROM shutdowns WHERE id = ?').get(shutdownId);
  if (!s) return;
  const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(s.group_id, s.created_by);
  if (!isMember) return;
  db.prepare(
    `INSERT INTO approvals (shutdown_id, user_id, response, condition_text, alternative_date, impact_text, impact_general, condition_resolved, responded_at)
     VALUES (?, ?, 'approved', '', '', '', '', 0, datetime('now'))
     ON CONFLICT(shutdown_id, user_id) DO NOTHING`
  ).run(shutdownId, s.created_by);
}

// איפוס תגובות לסבב אישור חדש (אחרי שינוי תאריך) — היוזם נשאר מאושר אוטומטית
export function resetApprovals(shutdownId) {
  db.prepare('DELETE FROM approvals WHERE shutdown_id = ?').run(shutdownId);
  autoApproveCreator(shutdownId);
}

export function touch(shutdownId) {
  db.prepare(`UPDATE shutdowns SET updated_at = datetime('now') WHERE id = ?`).run(shutdownId);
}

// תאריך בעברית לתצוגה בהודעות
export function fmtDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}
