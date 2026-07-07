import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db, { audit } from '../db/db.js';
import { requireAuth, requireAdmin, validate } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// רשימת משתמשים — לכל מחובר (לצורך הוספה לקבוצות), ללא נתונים רגישים
router.get('/', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const users = db.prepare(
    `SELECT id, username, display_name, role, created_at FROM users
     WHERE username LIKE ? OR display_name LIKE ? ORDER BY display_name`
  ).all(q, q);
  res.json({ users });
});

// יצירת משתמש ע"י admin
router.post('/', requireAdmin, validate(z.object({
  username: z.string().trim().min(2).max(50).regex(/^[a-zA-Z0-9_.\-@]+$/, 'שם משתמש לא תקין'),
  password: z.string().min(6, 'סיסמא: לפחות 6 תווים').max(100),
  display_name: z.string().trim().min(2).max(80),
  role: z.enum(['admin', 'user']).default('user')
})), (req, res) => {
  const { username, password, display_name, role } = req.body;
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'שם משתמש כבר קיים' });
  }
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)'
  ).run(username, bcrypt.hashSync(password, 10), display_name, role);
  audit(req.user.id, 'create_user', 'user', Number(info.lastInsertRowid), username);
  res.status(201).json({ user: db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(info.lastInsertRowid) });
});

// עדכון משתמש (איפוס סיסמא / שינוי תפקיד / שם תצוגה) ע"י admin
router.patch('/:id', requireAdmin, validate(z.object({
  password: z.string().min(6).max(100).optional(),
  display_name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(['admin', 'user']).optional()
})), (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });

  const { password, display_name, role } = req.body;
  if (role && id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'לא ניתן להסיר הרשאות admin מעצמך' });
  }
  // איפוס סיסמא מנתק מיידית את כל ההתחברויות הקיימות של המשתמש (token_version)
  if (password) {
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), id);
  }
  if (display_name) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name, id);
  if (role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);

  audit(req.user.id, 'update_user', 'user', id, JSON.stringify({ password: !!password, display_name, role }));
  res.json({ user: db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(id) });
});

// מחיקת משתמש ע"י admin
router.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'לא ניתן למחוק את עצמך' });
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req.user.id, 'delete_user', 'user', id, user.username);
  res.json({ ok: true });
});

export default router;
