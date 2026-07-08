// הודעות מנהלה לכל המשתמשים (לינור / מנהלי מערכת).
// ברירת מחדל: נשלחת גם כמייל לכולם, אלא אם סומן "לא לשלוח לכולם".
import { Router } from 'express';
import { z } from 'zod';
import db, { audit } from '../db/db.js';
import { requireAuth, requireAdmin, validate } from '../middleware/auth.js';
import { notifyUsers } from '../services/events.js';
import { mailUsers, mailEnabled } from '../services/mailer.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// שליחת הודעה לכולם
router.post('/', validate(z.object({
  body: z.string().trim().min(1, 'ההודעה ריקה').max(2000),
  email_all: z.boolean().default(true)
})), (req, res) => {
  const { body, email_all } = req.body;
  db.prepare('INSERT INTO announcements (user_id, body, email_all) VALUES (?, ?, ?)')
    .run(req.user.id, body, email_all ? 1 : 0);

  // כל המשתמשים למעט השולח
  const recipients = db.prepare('SELECT id FROM users WHERE id != ?').all(req.user.id).map(r => r.id);
  notifyUsers(recipients, {
    kind: 'announcement',
    body: `📣 הודעה מ${req.user.display_name}: ${body}`
  });
  if (email_all) {
    mailUsers(recipients, `הודעה מ${req.user.display_name}`, body);
  }
  audit(req.user.id, 'announcement', 'system', null, `email_all=${email_all}`);
  res.status(201).json({ ok: true, recipients: recipients.length, mail_sent: email_all && mailEnabled() });
});

// היסטוריית הודעות
router.get('/', (req, res) => {
  const items = db.prepare(
    `SELECT a.*, u.display_name AS sender FROM announcements a JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT 50`
  ).all();
  res.json({ announcements: items, mail_enabled: mailEnabled() });
});

export default router;
