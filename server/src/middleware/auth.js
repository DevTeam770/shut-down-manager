import jwt from 'jsonwebtoken';
import config from '../config.js';
import db from '../db/db.js';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, v: user.token_version ?? 0 },
    config.jwtSecret,
    { expiresIn: `${config.jwtExpiresDays}d` }
  );
}

// אימות טוקן + השוואת גרסה — איפוס סיסמא מנתק מיידית את כל ההתחברויות הקודמות
export function verifyToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  const user = db.prepare('SELECT id, username, display_name, role, token_version FROM users WHERE id = ?').get(payload.id);
  if (!user || user.token_version !== (payload.v ?? 0)) {
    const err = new Error('token revoked');
    err.name = 'TokenRevokedError';
    throw err;
  }
  return user;
}

// אימות בקשת HTTP — JWT מ-cookie בשם token
export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'נדרשת התחברות' });
  try {
    req.user = verifyToken(token); // משתמש טרי מה-DB, כולל בדיקת revocation
    next();
  } catch {
    return res.status(401).json({ error: 'התחברות פגה, יש להתחבר מחדש' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'נדרשות הרשאות מנהל מערכת' });
  next();
}

// האם המשתמש מנהל השבתה בקבוצה (או admin)
export function isGroupManager(userId, groupId) {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  if (user?.role === 'admin') return true;
  const m = db.prepare(
    'SELECT is_shutdown_manager FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, userId);
  return !!m?.is_shutdown_manager;
}

// האם המשתמש חבר בקבוצה (או admin)
export function isGroupMember(userId, groupId) {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  if (user?.role === 'admin') return true;
  const m = db.prepare('SELECT 1 AS ok FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
  return !!m;
}

// ולידציית zod כ-middleware
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.issues.map(i => i.message).join(', ');
      return res.status(400).json({ error: msg });
    }
    req.body = result.data;
    next();
  };
}
