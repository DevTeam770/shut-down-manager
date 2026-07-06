import { Router } from 'express';
import db from '../db/db.js';
import { requireAuth, isGroupMember } from '../middleware/auth.js';

const router = Router();

// אירועי לוח לחודש נתון (YYYY-MM) — רק השבתות מהקבוצות של המשתמש
router.get('/', requireAuth, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const base = `
    SELECT s.id, s.title, s.proposed_date, s.start_time, s.end_time, s.status, s.is_final_date, g.name AS group_name
    FROM shutdowns s JOIN groups g ON g.id = s.group_id
    WHERE s.proposed_date LIKE ? AND s.status != 'cancelled'`;
  let events;
  if (req.user.role === 'admin') {
    events = db.prepare(`${base} ORDER BY s.proposed_date`).all(`${month}%`);
  } else {
    events = db.prepare(
      `${base} AND EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = s.group_id AND m.user_id = ?)
       ORDER BY s.proposed_date`
    ).all(`${month}%`, req.user.id);
  }
  res.json({ month, events });
});

// בניית תוכן ICS (RFC 5545) — לפתיחה ב-Outlook
function buildIcs(shutdowns) {
  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Shutdown Manager//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');
  for (const s of shutdowns) {
    const date = s.proposed_date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:shutdown-${s.id}@shutdown-manager.local`);
    lines.push(`DTSTAMP:${now}`);
    if (s.start_time && s.end_time) {
      lines.push(`DTSTART:${date}T${s.start_time.replace(':', '')}00`);
      lines.push(`DTEND:${date}T${s.end_time.replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${date}`);
    }
    const finality = s.is_final_date ? 'תאריך סופי' : 'תאריך מוצע';
    lines.push(`SUMMARY:${esc(`השבתה: ${s.title} (${finality})`)}`);
    lines.push(`DESCRIPTION:${esc(`קבוצה: ${s.group_name}\n${s.description || ''}`)}`);
    lines.push(`STATUS:${s.is_final_date ? 'CONFIRMED' : 'TENTATIVE'}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ייצוא ICS של השבתה בודדת
router.get('/shutdowns/:id/ics', requireAuth, (req, res) => {
  const s = db.prepare(
    `SELECT s.*, g.name AS group_name FROM shutdowns s JOIN groups g ON g.id = s.group_id WHERE s.id = ?`
  ).get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'השבתה לא נמצאה' });
  if (!isGroupMember(req.user.id, s.group_id)) return res.status(403).json({ error: 'אין גישה' });
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename=shutdown-${s.id}.ics`);
  res.send(buildIcs([s]));
});

// פיד ICS של כל ההשבתות שלי — להוספה כ-Internet Calendar ב-Outlook
router.get('/my.ics', requireAuth, (req, res) => {
  const shutdowns = db.prepare(
    `SELECT s.*, g.name AS group_name FROM shutdowns s JOIN groups g ON g.id = s.group_id
     WHERE s.status != 'cancelled'
       AND EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = s.group_id AND m.user_id = ?)`
  ).all(req.user.id);
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename=my-shutdowns.ics');
  res.send(buildIcs(shutdowns));
});

export default router;
