import { Router } from 'express';
import db from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ההתראות שלי (אחרונות + כמות שלא נקראו)
router.get('/', (req, res) => {
  const notifications = db.prepare(
    `SELECT n.*, s.title AS shutdown_title FROM notifications n
     LEFT JOIN shutdowns s ON s.id = n.shutdown_id
     WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50`
  ).all(req.user.id);
  const unread = db.prepare(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL'
  ).get(req.user.id).c;
  res.json({ notifications, unread });
});

// סימון הכול כנקרא
router.post('/read-all', (req, res) => {
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`)
    .run(req.user.id);
  res.json({ ok: true });
});

// סימון התראה בודדת כנקראה
router.post('/:id/read', (req, res) => {
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

export default router;
