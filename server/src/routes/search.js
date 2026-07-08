// חיפוש גלובלי: השבתות, קבוצות, הודעות צ'אט וקבצים — בהיקף הקבוצות של המשתמש (admin: הכול)
import { Router } from 'express';
import db from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ shutdowns: [], groups: [], messages: [], files: [] });
  const like = `%${q}%`;
  const isAdmin = req.user.role === 'admin';
  // סינון הרשאות: רק תוכן מקבוצות שהמשתמש חבר בהן
  const memberScope = isAdmin ? '' : `AND EXISTS(
    SELECT 1 FROM group_members m WHERE m.group_id = s.group_id AND m.user_id = ${Number(req.user.id)})`;

  const shutdowns = db.prepare(
    `SELECT s.id, s.title, s.proposed_date, s.status, g.name AS group_name
     FROM shutdowns s JOIN groups g ON g.id = s.group_id
     WHERE (s.title LIKE ? OR s.description LIKE ?) ${memberScope}
     ORDER BY s.proposed_date DESC LIMIT 10`
  ).all(like, like);

  const groups = isAdmin
    ? db.prepare(`SELECT id, name FROM groups WHERE name LIKE ? LIMIT 10`).all(like)
    : db.prepare(
        `SELECT g.id, g.name FROM groups g
         WHERE g.name LIKE ? AND EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?)
         LIMIT 10`
      ).all(like, req.user.id);

  const messages = db.prepare(
    `SELECT msg.id, msg.shutdown_id, msg.body, msg.created_at,
       COALESCE(u.display_name, 'מערכת') AS display_name, s.title AS shutdown_title
     FROM messages msg
     JOIN shutdowns s ON s.id = msg.shutdown_id
     LEFT JOIN users u ON u.id = msg.user_id
     WHERE msg.body LIKE ? ${memberScope}
     ORDER BY msg.id DESC LIMIT 10`
  ).all(like);

  const files = db.prepare(
    `SELECT a.id, a.shutdown_id, a.original_name, s.title AS shutdown_title
     FROM attachments a JOIN shutdowns s ON s.id = a.shutdown_id
     WHERE a.original_name LIKE ? ${memberScope}
     ORDER BY a.id DESC LIMIT 10`
  ).all(like);

  res.json({ shutdowns, groups, messages, files });
});

export default router;
