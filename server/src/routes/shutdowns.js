import { Router } from 'express';
import { z } from 'zod';
import db, { audit } from '../db/db.js';
import { requireAuth, validate, isGroupManager, isGroupMember } from '../middleware/auth.js';
import {
  getShutdownFull, canTransition, isChatOpen, resetApprovals, touch, fmtDate, STATUS_LABELS
} from '../services/shutdowns.js';
import { systemMessage, notifyUsers, groupMemberIds, emitShutdownUpdate } from '../services/events.js';

const router = Router();
router.use(requireAuth);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'תאריך לא תקין');
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'שעה לא תקינה').or(z.literal('')).default('');

// עוזר: שליפת השבתה + בדיקת חברות בקבוצה
function loadShutdown(req, res) {
  const shutdown = db.prepare('SELECT * FROM shutdowns WHERE id = ?').get(Number(req.params.id));
  if (!shutdown) {
    res.status(404).json({ error: 'השבתה לא נמצאה' });
    return null;
  }
  if (!isGroupMember(req.user.id, shutdown.group_id)) {
    res.status(403).json({ error: 'אין גישה להשבתה זו' });
    return null;
  }
  return shutdown;
}

// השבתות בביצוע כרגע (לבאנר האתר) — חייב להיות לפני '/:id'
router.get('/active-now', (req, res) => {
  const base = `
    SELECT s.id, s.title, s.start_time, s.end_time, s.proposed_date, g.name AS group_name
    FROM shutdowns s JOIN groups g ON g.id = s.group_id
    WHERE s.status = 'in_progress'`;
  const rows = req.user.role === 'admin'
    ? db.prepare(base).all()
    : db.prepare(
        `${base} AND EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = s.group_id AND m.user_id = ?)`
      ).all(req.user.id);
  res.json({ active: rows });
});

// בדיקת התנגשויות: השבתות אחרות באותו תאריך שנוגעות לאותם אנשים — חייב להיות לפני '/:id'
router.get('/conflicts', (req, res) => {
  const date = String(req.query.date || '');
  const groupId = Number(req.query.group_id) || 0;
  const excludeId = Number(req.query.exclude_id) || 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !groupId) return res.json({ conflicts: [] });

  const conflicts = db.prepare(
    `SELECT s.id, s.title, g.name AS group_name, s.is_final_date,
       (SELECT COUNT(*) FROM group_members m1
        WHERE m1.group_id = s.group_id
          AND EXISTS(SELECT 1 FROM group_members m2 WHERE m2.group_id = ? AND m2.user_id = m1.user_id)
       ) AS shared_members
     FROM shutdowns s JOIN groups g ON g.id = s.group_id
     WHERE s.proposed_date = ? AND s.id != ? AND s.status NOT IN ('completed', 'cancelled')`
  ).all(groupId, date, excludeId).filter(c => c.shared_members > 0);
  res.json({ conflicts });
});

// רשימת השבתות של המשתמש (לפי חברות בקבוצות; admin רואה הכול)
router.get('/', (req, res) => {
  const base = `
    SELECT s.*, g.name AS group_name, u.display_name AS created_by_name,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id = s.group_id) AS member_count,
      (SELECT COUNT(*) FROM approvals a WHERE a.shutdown_id = s.id AND a.response = 'approved') AS approved_count,
      (SELECT COUNT(*) FROM approvals a WHERE a.shutdown_id = s.id) AS responded_count,
      (SELECT response FROM approvals a WHERE a.shutdown_id = s.id AND a.user_id = ?) AS my_response
    FROM shutdowns s JOIN groups g ON g.id = s.group_id JOIN users u ON u.id = s.created_by`;
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`${base} ORDER BY s.proposed_date DESC`).all(req.user.id);
  } else {
    rows = db.prepare(
      `${base} WHERE EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = s.group_id AND m.user_id = ?)
       ORDER BY s.proposed_date DESC`
    ).all(req.user.id, req.user.id);
  }
  res.json({ shutdowns: rows });
});

// יצירת השבתה (מנהל השבתה בקבוצה או admin)
router.post('/', validate(z.object({
  group_id: z.number().int().positive(),
  title: z.string().trim().min(2, 'כותרת קצרה מדי').max(120),
  description: z.string().trim().max(2000).default(''),
  proposed_date: dateSchema,
  start_time: timeSchema,
  end_time: timeSchema,
  respond_by: dateSchema.or(z.literal('')).default('')
})), (req, res) => {
  const { group_id, title, description, proposed_date, start_time, end_time, respond_by } = req.body;
  if (!db.prepare('SELECT id FROM groups WHERE id = ?').get(group_id)) {
    return res.status(404).json({ error: 'קבוצה לא נמצאה' });
  }
  if (!isGroupManager(req.user.id, group_id)) {
    return res.status(403).json({ error: 'רק מנהל השבתה של הקבוצה יכול ליצור השבתה' });
  }
  const info = db.prepare(
    `INSERT INTO shutdowns (group_id, title, description, proposed_date, start_time, end_time, respond_by, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(group_id, title, description, proposed_date, start_time, end_time, respond_by, req.user.id);
  const id = Number(info.lastInsertRowid);

  audit(req.user.id, 'create_shutdown', 'shutdown', id, title);
  const deadlineTxt = respond_by ? ` (להגיב עד ${fmtDate(respond_by)})` : '';
  systemMessage(id, `📢 ${req.user.display_name} פתח/ה השבתה חדשה: "${title}" בתאריך ${fmtDate(proposed_date)}${start_time ? ` בשעה ${start_time}` : ''}${deadlineTxt}`);
  notifyUsers(groupMemberIds(id, req.user.id), {
    kind: 'new_shutdown',
    body: `השבתה חדשה: "${title}" בתאריך ${fmtDate(proposed_date)} — נדרשת תגובתך${deadlineTxt}`,
    shutdownId: id,
    payload: { needs_response: true, title, proposed_date }
  });

  res.status(201).json({ shutdown: getShutdownFull(id) });
});

// פרטי השבתה מלאים
router.get('/:id', (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  res.json({
    shutdown: getShutdownFull(shutdown.id),
    is_manager: isGroupManager(req.user.id, shutdown.group_id),
    chat_open: isChatOpen(shutdown.status)
  });
});

// תגובת משתמש: אישור (ירוק) / דחייה (אדום) / מותנה (כתום)
router.post('/:id/respond', validate(z.object({
  response: z.enum(['approved', 'rejected', 'conditional']),
  condition_text: z.string().trim().max(500).default(''),
  alternative_date: dateSchema.or(z.literal('')).default('')
}).refine(d => d.response !== 'conditional' || d.condition_text.length > 0, {
  message: 'בתגובה מותנית חובה לפרט את התנאי ("תלוי ב...")'
})), (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  if (shutdown.status === 'completed' || shutdown.status === 'cancelled') {
    return res.status(400).json({ error: 'ההשבתה כבר הסתיימה' });
  }
  if (shutdown.is_final_date) {
    return res.status(400).json({ error: 'התאריך כבר נקבע כסופי' });
  }
  const { response, condition_text, alternative_date } = req.body;

  db.prepare(
    `INSERT INTO approvals (shutdown_id, user_id, response, condition_text, alternative_date, condition_resolved, responded_at)
     VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
     ON CONFLICT(shutdown_id, user_id) DO UPDATE SET
       response = excluded.response, condition_text = excluded.condition_text,
       alternative_date = excluded.alternative_date, condition_resolved = 0, responded_at = datetime('now')`
  ).run(shutdown.id, req.user.id, response, condition_text, alternative_date);
  touch(shutdown.id);
  audit(req.user.id, 'respond', 'shutdown', shutdown.id, JSON.stringify(req.body));

  // הודעת מערכת בצ'אט
  const altText = alternative_date ? ` ומציע/ה תאריך חלופי: ${fmtDate(alternative_date)}` : '';
  const texts = {
    approved: `✅ ${req.user.display_name} אישר/ה את התאריך ${fmtDate(shutdown.proposed_date)}`,
    rejected: `❌ ${req.user.display_name} דחה/תה את התאריך${condition_text ? `: ${condition_text}` : ''}${altText}`,
    conditional: `🟠 ${req.user.display_name} מתנה: "${condition_text}"${altText}`
  };
  systemMessage(shutdown.id, texts[response]);

  // התראה למנהלי ההשבתה של הקבוצה
  const managers = db.prepare(
    `SELECT user_id FROM group_members WHERE group_id = ? AND is_shutdown_manager = 1 AND user_id != ?`
  ).all(shutdown.group_id, req.user.id).map(r => r.user_id);
  const respLabels = { approved: 'אישר/ה', rejected: 'דחה/תה', conditional: 'התנה/תה' };
  notifyUsers(managers, {
    kind: 'response',
    body: `${req.user.display_name} ${respLabels[response]} את "${shutdown.title}"${altText}`,
    shutdownId: shutdown.id
  });
  emitShutdownUpdate(shutdown.id);

  res.json({ shutdown: getShutdownFull(shutdown.id) });
});

// עדכון השבתה: תאריך/שעות/סטטוס/קיבוע סופי (מנהל בלבד)
router.patch('/:id', validate(z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  proposed_date: dateSchema.optional(),
  start_time: timeSchema.optional(),
  end_time: timeSchema.optional(),
  respond_by: dateSchema.or(z.literal('')).optional(),
  status: z.enum(['proposed', 'confirmed', 'in_progress', 'completed', 'cancelled']).optional(),
  is_final_date: z.boolean().optional()
})), (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  if (!isGroupManager(req.user.id, shutdown.group_id)) {
    return res.status(403).json({ error: 'רק מנהל ההשבתה יכול לעדכן' });
  }
  const { title, description, proposed_date, start_time, end_time, respond_by, status, is_final_date } = req.body;

  // שינוי תאריך ⇦ סבב אישור חדש
  if (proposed_date && proposed_date !== shutdown.proposed_date) {
    db.prepare(`UPDATE shutdowns SET proposed_date = ?, is_final_date = 0, status = 'proposed' WHERE id = ?`)
      .run(proposed_date, shutdown.id);
    resetApprovals(shutdown.id);
    systemMessage(shutdown.id, `📅 ${req.user.display_name} עדכן/ה את התאריך ל-${fmtDate(proposed_date)} — נדרש סבב אישור חדש`);
    notifyUsers(groupMemberIds(shutdown.id, req.user.id), {
      kind: 'date_changed',
      body: `התאריך של "${shutdown.title}" עודכן ל-${fmtDate(proposed_date)} — נדרשת תגובתך מחדש`,
      shutdownId: shutdown.id,
      payload: { needs_response: true, title: shutdown.title, proposed_date }
    });
  }

  if (title) db.prepare('UPDATE shutdowns SET title = ? WHERE id = ?').run(title, shutdown.id);
  if (description !== undefined) db.prepare('UPDATE shutdowns SET description = ? WHERE id = ?').run(description, shutdown.id);
  if (start_time !== undefined) db.prepare('UPDATE shutdowns SET start_time = ? WHERE id = ?').run(start_time, shutdown.id);
  if (end_time !== undefined) db.prepare('UPDATE shutdowns SET end_time = ? WHERE id = ?').run(end_time, shutdown.id);
  if (respond_by !== undefined) db.prepare('UPDATE shutdowns SET respond_by = ? WHERE id = ?').run(respond_by, shutdown.id);

  // קיבוע תאריך סופי (ירוק בלוח)
  if (is_final_date === true && !shutdown.is_final_date) {
    db.prepare(`UPDATE shutdowns SET is_final_date = 1, status = CASE WHEN status = 'proposed' THEN 'confirmed' ELSE status END WHERE id = ?`)
      .run(shutdown.id);
    const current = db.prepare('SELECT proposed_date, title FROM shutdowns WHERE id = ?').get(shutdown.id);
    systemMessage(shutdown.id, `🟢 התאריך ${fmtDate(current.proposed_date)} נקבע כסופי!`);
    notifyUsers(groupMemberIds(shutdown.id, req.user.id), {
      kind: 'date_final',
      body: `התאריך של "${current.title}" נקבע סופית: ${fmtDate(current.proposed_date)}`,
      shutdownId: shutdown.id
    });
  }

  // מעבר סטטוס
  if (status && status !== shutdown.status) {
    const fresh = db.prepare('SELECT status FROM shutdowns WHERE id = ?').get(shutdown.id);
    if (!canTransition(fresh.status, status)) {
      return res.status(400).json({ error: `לא ניתן לעבור מ"${STATUS_LABELS[fresh.status]}" ל"${STATUS_LABELS[status]}"` });
    }
    db.prepare('UPDATE shutdowns SET status = ? WHERE id = ?').run(status, shutdown.id);
    const statusMsgs = {
      confirmed: '🟢 ההשבתה אושרה',
      in_progress: '🔧 ההשבתה החלה — החדר פתוח לדיווחים שוטפים',
      completed: '🏁 ההשבתה הסתיימה — הצ\'אט נסגר לכתיבה. תודה לכולם!',
      cancelled: '🚫 ההשבתה בוטלה',
      proposed: '↩️ ההשבתה חזרה למצב הצעה'
    };
    systemMessage(shutdown.id, statusMsgs[status]);
    notifyUsers(groupMemberIds(shutdown.id, req.user.id), {
      kind: 'status',
      body: `"${shutdown.title}" — ${statusMsgs[status]}`,
      shutdownId: shutdown.id
    });
  }

  touch(shutdown.id);
  audit(req.user.id, 'update_shutdown', 'shutdown', shutdown.id, JSON.stringify(req.body));
  emitShutdownUpdate(shutdown.id);
  res.json({ shutdown: getShutdownFull(shutdown.id) });
});

// אימוץ תאריך חלופי שהוצע ע"י משתמש — קיצור דרך לשינוי תאריך
router.post('/:id/adopt-date', validate(z.object({
  from_user_id: z.number().int().positive()
})), (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  if (!isGroupManager(req.user.id, shutdown.group_id)) {
    return res.status(403).json({ error: 'רק מנהל ההשבתה יכול לאמץ תאריך' });
  }
  const approval = db.prepare(
    'SELECT a.*, u.display_name FROM approvals a JOIN users u ON u.id = a.user_id WHERE a.shutdown_id = ? AND a.user_id = ?'
  ).get(shutdown.id, req.body.from_user_id);
  if (!approval?.alternative_date) {
    return res.status(404).json({ error: 'לא נמצא תאריך חלופי מהמשתמש הזה' });
  }
  const newDate = approval.alternative_date;
  db.prepare(`UPDATE shutdowns SET proposed_date = ?, is_final_date = 0, status = 'proposed' WHERE id = ?`)
    .run(newDate, shutdown.id);
  resetApprovals(shutdown.id);
  touch(shutdown.id);
  audit(req.user.id, 'adopt_date', 'shutdown', shutdown.id, newDate);

  systemMessage(shutdown.id, `📅 ${req.user.display_name} אימץ/ה את התאריך החלופי של ${approval.display_name}: ${fmtDate(newDate)} — נדרש סבב אישור חדש`);
  notifyUsers(groupMemberIds(shutdown.id, req.user.id), {
    kind: 'date_changed',
    body: `התאריך של "${shutdown.title}" עודכן ל-${fmtDate(newDate)} — נדרשת תגובתך מחדש`,
    shutdownId: shutdown.id,
    payload: { needs_response: true, title: shutdown.title, proposed_date: newDate }
  });
  emitShutdownUpdate(shutdown.id);
  res.json({ shutdown: getShutdownFull(shutdown.id) });
});

// סימון תנאי כנפתר (מנהל)
router.patch('/:id/approvals/:userId/resolve', (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  if (!isGroupManager(req.user.id, shutdown.group_id)) {
    return res.status(403).json({ error: 'רק מנהל ההשבתה יכול לסמן תנאי כנפתר' });
  }
  const userId = Number(req.params.userId);
  const approval = db.prepare(
    'SELECT a.*, u.display_name FROM approvals a JOIN users u ON u.id = a.user_id WHERE a.shutdown_id = ? AND a.user_id = ?'
  ).get(shutdown.id, userId);
  if (!approval || approval.response !== 'conditional') {
    return res.status(404).json({ error: 'לא נמצאה תגובה מותנית מהמשתמש' });
  }
  db.prepare('UPDATE approvals SET condition_resolved = 1 WHERE shutdown_id = ? AND user_id = ?')
    .run(shutdown.id, userId);
  touch(shutdown.id);
  audit(req.user.id, 'resolve_condition', 'shutdown', shutdown.id, String(userId));

  systemMessage(shutdown.id, `✔️ התנאי של ${approval.display_name} ("${approval.condition_text}") סומן כנפתר`);
  notifyUsers([userId], {
    kind: 'resolved',
    body: `התנאי שלך בהשבתה "${shutdown.title}" סומן כנפתר`,
    shutdownId: shutdown.id
  });
  emitShutdownUpdate(shutdown.id);
  res.json({ shutdown: getShutdownFull(shutdown.id) });
});

// סיכום השבתה: תקציר + ציון + לקחים (מנהל, אחרי סיום)
router.post('/:id/review', validate(z.object({
  summary: z.string().trim().max(2000).default(''),
  score: z.number().int().min(1, 'ציון בין 1 ל-10').max(10, 'ציון בין 1 ל-10'),
  lessons: z.string().trim().max(2000).default('')
})), (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  if (!isGroupManager(req.user.id, shutdown.group_id)) {
    return res.status(403).json({ error: 'רק מנהל ההשבתה יכול לסכם' });
  }
  if (shutdown.status !== 'completed') {
    return res.status(400).json({ error: 'ניתן לסכם רק השבתה שהסתיימה' });
  }
  const { summary, score, lessons } = req.body;
  db.prepare(
    `INSERT INTO shutdown_reviews (shutdown_id, summary, score, lessons, created_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(shutdown_id) DO UPDATE SET summary = excluded.summary, score = excluded.score, lessons = excluded.lessons`
  ).run(shutdown.id, summary, score, lessons, req.user.id);
  audit(req.user.id, 'review', 'shutdown', shutdown.id, `score=${score}`);
  notifyUsers(groupMemberIds(shutdown.id, req.user.id), {
    kind: 'review',
    body: `פורסם סיכום להשבתה "${shutdown.title}" — ציון ${score}/10`,
    shutdownId: shutdown.id
  });
  res.json({ shutdown: getShutdownFull(shutdown.id) });
});

// היסטוריית צ'אט עם pagination (before_id לגלילה אחורה, after_id לסנכרון אחרי ניתוק)
router.get('/:id/messages', (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const beforeId = Number(req.query.before_id) || null;
  const afterId = Number(req.query.after_id) || null;

  let messages;
  const base = `
    SELECT m.*, COALESCE(u.display_name, 'מערכת') AS display_name
    FROM messages m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.shutdown_id = ?`;
  if (afterId) {
    messages = db.prepare(`${base} AND m.id > ? ORDER BY m.id LIMIT ?`).all(shutdown.id, afterId, limit);
  } else if (beforeId) {
    messages = db.prepare(`${base} AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(shutdown.id, beforeId, limit).reverse();
  } else {
    messages = db.prepare(`${base} ORDER BY m.id DESC LIMIT ?`).all(shutdown.id, limit).reverse();
  }
  res.json({ messages, chat_open: isChatOpen(shutdown.status) });
});

export default router;
