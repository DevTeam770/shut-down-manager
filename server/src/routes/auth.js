import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import db, { audit } from '../db/db.js';
import config from '../config.js';
import { signToken, requireAuth, validate } from '../middleware/auth.js';

const router = Router();

// הגנת brute-force על התחברות
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'יותר מדי ניסיונות התחברות, נסו שוב בעוד מספר דקות' }
});

const credentialsSchema = z.object({
  username: z.string().trim().min(2, 'שם משתמש קצר מדי').max(50, 'שם משתמש ארוך מדי')
    .regex(/^[a-zA-Z0-9_.\-@]+$/, 'שם משתמש: אותיות באנגלית, ספרות, נקודה, מקף וקו תחתון בלבד'),
  password: z.string().min(6, 'סיסמא חייבת להכיל לפחות 6 תווים').max(100),
  display_name: z.string().trim().min(2, 'שם תצוגה קצר מדי').max(80).optional()
});

const cookieOpts = {
  httpOnly: true,
  sameSite: 'strict',
  maxAge: config.jwtExpiresDays * 24 * 60 * 60 * 1000
};

router.post('/register', validate(credentialsSchema), (req, res) => {
  const { username, password, display_name } = req.body;
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'שם משתמש כבר קיים' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    `INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)`
  ).run(username, hash, display_name || username);

  const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(info.lastInsertRowid);
  audit(user.id, 'register', 'user', user.id, username);
  res.cookie('token', signToken(user), cookieOpts);
  res.status(201).json({ user });
});

router.post('/login', loginLimiter, validate(credentialsSchema.pick({ username: true, password: true })), (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'שם משתמש או סיסמא שגויים' });
  }
  const publicUser = { id: user.id, username: user.username, display_name: user.display_name, role: user.role };
  res.cookie('token', signToken(publicUser), cookieOpts);
  res.json({ user: publicUser });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// שינוי סיסמא עצמי
router.post('/change-password', requireAuth, validate(z.object({
  current_password: z.string().min(1, 'נדרשת סיסמא נוכחית'),
  new_password: z.string().min(6, 'סיסמא חדשה חייבת להכיל לפחות 6 תווים').max(100)
})), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(req.body.current_password, user.password_hash)) {
    return res.status(401).json({ error: 'סיסמא נוכחית שגויה' });
  }
  // הקפצת token_version מנתקת את כל שאר ההתחברויות; מנפיקים cookie חדש כדי שהמשתמש הנוכחי יישאר מחובר
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(bcrypt.hashSync(req.body.new_password, 10), req.user.id);
  const fresh = db.prepare('SELECT id, username, display_name, role, token_version FROM users WHERE id = ?').get(req.user.id);
  res.cookie('token', signToken(fresh), cookieOpts);
  audit(req.user.id, 'change_password', 'user', req.user.id);
  res.json({ ok: true });
});

export default router;
