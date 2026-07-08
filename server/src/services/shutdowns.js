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
// viewerRole — כשאינו 'admin', פריטי צ'קליסט פרטיים (admin_only) מסוננים החוצה.
export function getShutdownFull(id, viewerRole = 'admin') {
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

  const review = db.prepare('SELECT * FROM shutdown_reviews WHERE shutdown_id = ?').get(id) || null;

  const checklist = db.prepare(
    `SELECT c.*, u.display_name AS done_by_name FROM checklist_items c
     LEFT JOIN users u ON u.id = c.done_by
     WHERE c.shutdown_id = ? ${viewerRole === 'admin' ? '' : 'AND c.admin_only = 0'}
     ORDER BY c.phase, c.position, c.id`
  ).all(id);

  const feedback = db.prepare(
    `SELECT f.*, u.display_name FROM participant_feedback f JOIN users u ON u.id = f.user_id
     WHERE f.shutdown_id = ? ORDER BY f.created_at`
  ).all(id);
  const avgFeedback = feedback.length
    ? Math.round((feedback.reduce((s, f) => s + f.score, 0) / feedback.length) * 10) / 10
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

// איפוס תגובות לסבב אישור חדש (אחרי שינוי תאריך)
export function resetApprovals(shutdownId) {
  db.prepare('DELETE FROM approvals WHERE shutdown_id = ?').run(shutdownId);
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
