import { Router } from 'express';
import { z } from 'zod';
import db, { audit } from '../db/db.js';
import { requireAuth, validate, isGroupManager, isGroupMember } from '../middleware/auth.js';
import {
  getShutdownFull, canTransition, isChatOpen, resetApprovals, touch, fmtDate, STATUS_LABELS
} from '../services/shutdowns.js';
import { systemMessage, notifyUsers, groupMemberIds, emitShutdownUpdate, emitActiveChanged } from '../services/events.js';
import { mailUsers } from '../services/mailer.js';

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
  respond_by: dateSchema.or(z.literal('')).default(''),
  checklist: z.array(z.object({
    text: z.string().trim().min(1).max(300),
    phase: z.enum(['before', 'during', 'after']).default('before')
  })).max(100).default([])
})), (req, res) => {
  const { group_id, title, description, proposed_date, start_time, end_time, respond_by, checklist } = req.body;
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

  // צ'קליסט התחלתי (למשל הועתק מתבנית של השבתה קודמת)
  if (checklist.length) {
    const ins = db.prepare('INSERT INTO checklist_items (shutdown_id, text, phase, position) VALUES (?, ?, ?, ?)');
    checklist.forEach((item, i) => ins.run(id, item.text, item.phase, i + 1));
  }

  audit(req.user.id, 'create_shutdown', 'shutdown', id, title);
  const deadlineTxt = respond_by ? ` (להגיב עד ${fmtDate(respond_by)})` : '';
  systemMessage(id, `📢 ${req.user.display_name} פתח/ה השבתה חדשה: "${title}" בתאריך ${fmtDate(proposed_date)}${start_time ? ` בשעה ${start_time}` : ''}${deadlineTxt}`);
  notifyUsers(groupMemberIds(id, req.user.id), {
    kind: 'new_shutdown',
    body: `השבתה חדשה: "${title}" בתאריך ${fmtDate(proposed_date)} — נדרשת תגובתך${deadlineTxt}`,
    shutdownId: id,
    payload: { needs_response: true, title, proposed_date }
  });

  res.status(201).json({ shutdown: getShutdownFull(id, req.user.role) });
});

// פרטי השבתה מלאים
router.get('/:id', (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  res.json({
    shutdown: getShutdownFull(shutdown.id, req.user.role),
    is_manager: isGroupManager(req.user.id, shutdown.group_id),
    chat_open: isChatOpen(shutdown.status)
  });
});

// תגובת משתמש: אישור (ירוק) / דחייה (אדום) / מותנה (כתום)
router.post('/:id/respond', validate(z.object({
  response: z.enum(['approved', 'rejected', 'conditional']),
  condition_text: z.string().trim().max(500).default(''),
  alternative_date: dateSchema.or(z.literal('')).default(''),
  impact_text: z.string().trim().max(1000).default('') // משמעות ההשבתה על המשתמש
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
  const { response, condition_text, alternative_date, impact_text } = req.body;

  db.prepare(
    `INSERT INTO approvals (shutdown_id, user_id, response, condition_text, alternative_date, impact_text, condition_resolved, responded_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
     ON CONFLICT(shutdown_id, user_id) DO UPDATE SET
       response = excluded.response, condition_text = excluded.condition_text,
       alternative_date = excluded.alternative_date, impact_text = excluded.impact_text,
       condition_resolved = 0, responded_at = datetime('now')`
  ).run(shutdown.id, req.user.id, response, condition_text, alternative_date, impact_text);
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

  // כשכל חברי הקבוצה הגיבו וכולם אישרו — ריכוז המשמעויות למסמך ושליחה למנהלי המערכת (לינור)
  maybeSendConsolidatedDoc(shutdown);

  res.json({ shutdown: getShutdownFull(shutdown.id, req.user.role) });
});

// בדיקה: כל חברי הקבוצה אישרו ⇦ שליחת המסמך המרוכז פעם אחת (doc_sent)
function maybeSendConsolidatedDoc(shutdown) {
  const fresh = db.prepare('SELECT * FROM shutdowns WHERE id = ?').get(shutdown.id);
  if (fresh.doc_sent) return;
  const memberCount = db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(fresh.group_id).c;
  const approvedCount = db.prepare(
    `SELECT COUNT(*) AS c FROM approvals a JOIN group_members m ON m.user_id = a.user_id AND m.group_id = ?
     WHERE a.shutdown_id = ? AND a.response = 'approved'`
  ).get(fresh.group_id, fresh.id).c;
  if (memberCount === 0 || approvedCount < memberCount) return;

  db.prepare('UPDATE shutdowns SET doc_sent = 1 WHERE id = ?').run(fresh.id);

  const approvals = db.prepare(
    `SELECT a.impact_text, u.display_name FROM approvals a JOIN users u ON u.id = a.user_id
     WHERE a.shutdown_id = ? ORDER BY u.display_name`
  ).all(fresh.id);
  const lines = approvals.map(a => `• ${a.display_name}: ${a.impact_text || '(לא נכתבה משמעות)'}`).join('\n');
  const mailBody =
    `כל חברי הקבוצה אישרו את ההשבתה "${fresh.title}" בתאריך ${fmtDate(fresh.proposed_date)}.\n\n` +
    `משמעויות ההשבתה לפי המשתתפים:\n${lines}\n\n` +
    `למסמך המלא להדפסה: פתחו את דף ההשבתה במערכת ולחצו על "מסמך מרוכז".`;

  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all().map(r => r.id);
  systemMessage(fresh.id, '📄 כל החברים אישרו — המסמך המרוכז מוכן ונשלח למנהלי המערכת');
  notifyUsers(admins, {
    kind: 'doc_ready',
    body: `📄 המסמך המרוכז של "${fresh.title}" מוכן — כל החברים אישרו`,
    shutdownId: fresh.id
  });
  mailUsers(admins, `מסמך מרוכז: ${fresh.title}`, mailBody);
}

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
    emitActiveChanged(); // רענון הבאנר אצל כולם, כולל מבצע הפעולה
  }

  touch(shutdown.id);
  audit(req.user.id, 'update_shutdown', 'shutdown', shutdown.id, JSON.stringify(req.body));
  emitShutdownUpdate(shutdown.id);
  res.json({ shutdown: getShutdownFull(shutdown.id, req.user.role) });
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
  res.json({ shutdown: getShutdownFull(shutdown.id, req.user.role) });
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
  res.json({ shutdown: getShutdownFull(shutdown.id, req.user.role) });
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
  res.json({ shutdown: getShutdownFull(shutdown.id, req.user.role) });
});

// מסמך מרוכז מקצועי להדפסה/PDF/הורדה — אישורים, משמעויות, וסיכום (מנהל/admin).
// ?download=1 מוריד כקובץ HTML; אחרת נפתח לצפייה עם כפתור הדפסה.
router.get('/:id/document', (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  if (!isGroupManager(req.user.id, shutdown.group_id)) {
    return res.status(403).json({ error: 'רק מנהל השבתה או מנהל מערכת יכולים לצפות במסמך' });
  }
  const s = getShutdownFull(shutdown.id, 'admin');
  const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  const respLabels = { approved: '✓ אישר/ה', rejected: '✗ דחה/תה', conditional: '~ מותנה' };
  const respColor = { approved: '#16a34a', rejected: '#dc2626', conditional: '#ea580c' };
  const genTime = new Date().toLocaleString('he-IL');

  const rows = s.members.map((m, i) => {
    const a = s.approvals.find(x => x.user_id === m.id);
    const resp = a ? respLabels[a.response] : '⏳ טרם הגיב/ה';
    const color = a ? respColor[a.response] : '#64708a';
    const when = a?.responded_at ? new Date(a.responded_at.replace(' ', 'T') + 'Z').toLocaleString('he-IL') : '';
    return `<tr${i % 2 ? ' class="alt"' : ''}>
      <td class="name">${esc(m.display_name)}</td>
      <td style="color:${color};font-weight:600;white-space:nowrap">${resp}</td>
      <td>${esc(a?.impact_text || '—')}${a?.condition_text ? `<div class="cond">תנאי: ${esc(a.condition_text)}</div>` : ''}</td>
      <td class="when">${when}</td>
    </tr>`;
  }).join('');

  // מקטע סיכום ומשוב — רק כשהושלמה וקיים סיכום/משוב
  let summarySection = '';
  if (s.review) {
    summarySection += `
    <h2>סיכום ההשבתה</h2>
    <div class="summary-box">
      <div class="score">ציון: <strong>${s.review.score}/10</strong></div>
      ${s.review.summary ? `<p><b>תקציר:</b> ${esc(s.review.summary)}</p>` : ''}
      ${s.review.lessons ? `<p><b>לקחים לשיפור:</b> ${esc(s.review.lessons)}</p>` : ''}
    </div>`;
  }
  if (s.feedback?.length) {
    const fb = s.feedback.map(f => `<tr><td class="name">${esc(f.display_name)}</td><td>${f.score}/10</td><td>${esc(f.comment || '—')}</td></tr>`).join('');
    summarySection += `
    <h2>משוב המשתתפים ${s.avg_feedback != null ? `(ממוצע ${s.avg_feedback}/10)` : ''}</h2>
    <table><thead><tr><th>משתתף</th><th>ציון</th><th>הערה</th></tr></thead><tbody>${fb}</tbody></table>`;
  }

  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>מסמך השבתה — ${esc(s.title)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', 'Arial Hebrew', Arial, sans-serif; color: #1a2233; margin: 0; padding: 32px; background: #fff; line-height: 1.5; }
  .sheet { max-width: 900px; margin: 0 auto; }
  .doc-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #2563eb; padding-bottom: 14px; margin-bottom: 20px; }
  .doc-header .brand { font-size: 15px; font-weight: 700; color: #2563eb; }
  .doc-header h1 { margin: 0; font-size: 24px; }
  .doc-header .gen { font-size: 12px; color: #64708a; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; background: #f4f6fa; border: 1px solid #dbe1ea; border-radius: 8px; padding: 14px 18px; margin-bottom: 22px; font-size: 14px; }
  .meta-grid .k { color: #64708a; } .meta-grid .v { font-weight: 600; }
  .status-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  h2 { font-size: 17px; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #dbe1ea; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { border: 1px solid #dbe1ea; padding: 8px 10px; text-align: right; vertical-align: top; }
  th { background: #eef1f6; font-weight: 700; }
  tr.alt td { background: #fafbfd; }
  td.name { font-weight: 600; white-space: nowrap; }
  td.when { color: #64708a; font-size: 12px; white-space: nowrap; }
  .cond { color: #ea580c; font-size: 12px; margin-top: 3px; }
  .summary-box { background: #f4f6fa; border: 1px solid #dbe1ea; border-radius: 8px; padding: 14px 18px; }
  .summary-box .score { font-size: 16px; margin-bottom: 6px; }
  .sign { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .sign .line { border-top: 1px solid #1a2233; padding-top: 6px; font-size: 13px; color: #64708a; }
  .footer { margin-top: 32px; padding-top: 10px; border-top: 1px solid #dbe1ea; font-size: 11px; color: #93a0b8; text-align: center; }
  .toolbar { text-align: center; margin-bottom: 20px; }
  .toolbar button, .toolbar a { padding: 9px 18px; font-size: 14px; font-weight: 600; border-radius: 8px; border: 1px solid #2563eb; background: #2563eb; color: #fff; cursor: pointer; text-decoration: none; margin: 0 4px; }
  .toolbar a.ghost { background: #fff; color: #2563eb; }
  @media print { .toolbar { display: none; } body { padding: 0; } }
</style></head><body>
<div class="sheet">
  <div class="toolbar">
    <button onclick="window.print()">🖨️ הדפסה / שמירה כ-PDF</button>
    <a class="ghost" href="?download=1">⬇️ הורדת קובץ</a>
  </div>
  <div class="doc-header">
    <div>
      <div class="brand">🔌 מערכת ניהול השבתות</div>
      <h1>מסמך השבתה מרוכז</h1>
    </div>
    <div class="gen">הופק: ${genTime}</div>
  </div>
  <div class="meta-grid">
    <div><span class="k">כותרת:</span> <span class="v">${esc(s.title)}</span></div>
    <div><span class="k">קבוצה:</span> <span class="v">${esc(s.group_name)}</span></div>
    <div><span class="k">תאריך מתוכנן:</span> <span class="v">${fmtDate(s.proposed_date)}${s.start_time ? ` ${esc(s.start_time)}${s.end_time ? '–' + esc(s.end_time) : ''}` : ''}</span></div>
    <div><span class="k">קביעות:</span> <span class="status-pill" style="background:${s.is_final_date ? '#dcfce7' : '#ffedd5'};color:${s.is_final_date ? '#16a34a' : '#ea580c'}">${s.is_final_date ? 'תאריך סופי' : 'תאריך מוצע'}</span></div>
    <div><span class="k">נפתחה ע"י:</span> <span class="v">${esc(s.created_by_name)}</span></div>
    <div><span class="k">אישרו:</span> <span class="v">${s.approved_count}/${s.members.length}</span></div>
    ${s.description ? `<div style="grid-column:1/-1"><span class="k">תיאור:</span> <span class="v">${esc(s.description)}</span></div>` : ''}
  </div>

  <h2>אישורים ומשמעויות</h2>
  <table>
    <thead><tr><th>משתתף</th><th>תגובה</th><th>משמעות ההשבתה עליו/עליה</th><th>מועד תגובה</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${summarySection}

  <div class="sign">
    <div class="line">חתימת מנהל/ת ההשבתה</div>
    <div class="line">חתימת מנהל/ת המערכת</div>
  </div>
  <div class="footer">מסמך זה הופק אוטומטית ממערכת ניהול ההשבתות · ${genTime}</div>
</div>
</body></html>`;

  res.set('Content-Type', 'text/html; charset=utf-8');
  // CSP ייעודי לעמוד המסמך הבודד — מתיר את כפתור ההדפסה (onclick) שה-CSP הגלובלי חוסם
  res.set('Content-Security-Policy',
    "default-src 'self'; script-src 'unsafe-inline'; script-src-attr 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:");
  if (req.query.download) {
    res.set('Content-Disposition', `attachment; filename="shutdown-${s.id}.html"`);
  }
  res.send(html);
});

// משוב אישי של משתתף — רק אחרי שההשבתה הסתיימה; ניתן לעדכן (upsert)
router.post('/:id/feedback', validate(z.object({
  score: z.number().int().min(1, 'ציון בין 1 ל-10').max(10, 'ציון בין 1 ל-10'),
  comment: z.string().trim().max(1000).default('')
})), (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  if (shutdown.status !== 'completed') {
    return res.status(400).json({ error: 'ניתן לתת משוב רק אחרי שההשבתה הסתיימה' });
  }
  db.prepare(
    `INSERT INTO participant_feedback (shutdown_id, user_id, score, comment) VALUES (?, ?, ?, ?)
     ON CONFLICT(shutdown_id, user_id) DO UPDATE SET score = excluded.score, comment = excluded.comment`
  ).run(shutdown.id, req.user.id, req.body.score, req.body.comment);
  audit(req.user.id, 'feedback', 'shutdown', shutdown.id, `score=${req.body.score}`);
  emitShutdownUpdate(shutdown.id);
  res.json({ shutdown: getShutdownFull(shutdown.id, req.user.role) });
});

// היסטוריית צ'אט עם pagination (before_id לגלילה אחורה, after_id לסנכרון אחרי ניתוק)
// פרמטר q — חיפוש טקסט בהודעות (עד 100 תוצאות)
router.get('/:id/messages', (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const beforeId = Number(req.query.before_id) || null;
  const afterId = Number(req.query.after_id) || null;
  const q = String(req.query.q || '').trim();

  // סינון נראות הודעות פרטיות: מוצגות רק לשולח, לנמען ולמנהלי מערכת
  const vis = req.user.role === 'admin'
    ? ''
    : `AND (m.recipient_id IS NULL OR m.recipient_id = ${Number(req.user.id)} OR m.user_id = ${Number(req.user.id)})`;

  let messages;
  const base = `
    SELECT m.*, COALESCE(u.display_name, 'מערכת') AS display_name, u.role AS role
    FROM messages m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.shutdown_id = ? ${vis}`;
  if (q) {
    messages = db.prepare(`${base} AND m.body LIKE ? ORDER BY m.id DESC LIMIT 100`)
      .all(shutdown.id, `%${q}%`).reverse();
  } else if (afterId) {
    messages = db.prepare(`${base} AND m.id > ? ORDER BY m.id LIMIT ?`).all(shutdown.id, afterId, limit);
  } else if (beforeId) {
    messages = db.prepare(`${base} AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(shutdown.id, beforeId, limit).reverse();
  } else {
    messages = db.prepare(`${base} ORDER BY m.id DESC LIMIT ?`).all(shutdown.id, limit).reverse();
  }
  res.json({ messages, chat_open: isChatOpen(shutdown.status) });
});

export default router;
