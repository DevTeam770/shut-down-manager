import { Router } from 'express';
import { z } from 'zod';
import db, { audit } from '../db/db.js';
import { requireAuth, validate, isGroupManager } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// האם המשתמש רשאי ליצור קבוצות: admin או מנהל השבתה בקבוצה כלשהי
function canCreateGroups(user) {
  if (user.role === 'admin') return true;
  const m = db.prepare('SELECT 1 AS ok FROM group_members WHERE user_id = ? AND is_shutdown_manager = 1').get(user.id);
  return !!m;
}

// רשימה + חיפוש קבוצות. admin רואה הכול; משתמש רגיל רואה את הקבוצות שלו + תוצאות חיפוש בשם
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let groups;
  const base = `
    SELECT g.*, u.display_name AS created_by_name,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count,
      EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?) AS is_member,
      COALESCE((SELECT is_shutdown_manager FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?), 0) AS is_manager
    FROM groups g JOIN users u ON u.id = g.created_by`;
  if (q) {
    groups = db.prepare(`${base} WHERE g.name LIKE ? ORDER BY g.name`).all(req.user.id, req.user.id, `%${q}%`);
  } else if (req.user.role === 'admin') {
    groups = db.prepare(`${base} ORDER BY g.name`).all(req.user.id, req.user.id);
  } else {
    groups = db.prepare(
      `${base} WHERE EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?) ORDER BY g.name`
    ).all(req.user.id, req.user.id, req.user.id);
  }
  res.json({ groups, can_create: canCreateGroups(req.user) });
});

// יצירת קבוצה
router.post('/', validate(z.object({
  name: z.string().trim().min(2, 'שם קבוצה קצר מדי').max(80),
  description: z.string().trim().max(500).default('')
})), (req, res) => {
  if (!canCreateGroups(req.user)) return res.status(403).json({ error: 'אין הרשאה ליצור קבוצות' });
  const { name, description } = req.body;
  if (db.prepare('SELECT id FROM groups WHERE name = ?').get(name)) {
    return res.status(409).json({ error: 'קבוצה בשם זה כבר קיימת' });
  }
  const info = db.prepare('INSERT INTO groups (name, description, created_by) VALUES (?, ?, ?)')
    .run(name, description, req.user.id);
  const groupId = Number(info.lastInsertRowid);
  // היוצר מצטרף אוטומטית כמנהל השבתה בקבוצה
  db.prepare('INSERT INTO group_members (group_id, user_id, is_shutdown_manager) VALUES (?, ?, 1)')
    .run(groupId, req.user.id);
  audit(req.user.id, 'create_group', 'group', groupId, name);
  res.status(201).json({ group: db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) });
});

// פרטי קבוצה + חברים
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!group) return res.status(404).json({ error: 'קבוצה לא נמצאה' });
  const members = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, m.is_shutdown_manager, m.added_at
     FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.display_name`
  ).all(id);
  res.json({
    group,
    members,
    is_manager: isGroupManager(req.user.id, id)
  });
});

// הוספת חבר לקבוצה (מנהל השבתה של הקבוצה או admin)
router.post('/:id/members', validate(z.object({
  user_id: z.number().int().positive(),
  is_shutdown_manager: z.boolean().default(false)
})), (req, res) => {
  const groupId = Number(req.params.id);
  if (!db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId)) {
    return res.status(404).json({ error: 'קבוצה לא נמצאה' });
  }
  if (!isGroupManager(req.user.id, groupId)) {
    return res.status(403).json({ error: 'רק מנהל השבתה של הקבוצה יכול להוסיף חברים' });
  }
  const { user_id, is_shutdown_manager } = req.body;
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(user_id)) {
    return res.status(404).json({ error: 'משתמש לא נמצא' });
  }
  db.prepare(
    `INSERT INTO group_members (group_id, user_id, is_shutdown_manager) VALUES (?, ?, ?)
     ON CONFLICT(group_id, user_id) DO UPDATE SET is_shutdown_manager = excluded.is_shutdown_manager`
  ).run(groupId, user_id, is_shutdown_manager ? 1 : 0);
  audit(req.user.id, 'add_member', 'group', groupId, JSON.stringify({ user_id, is_shutdown_manager }));
  res.status(201).json({ ok: true });
});

// הסרת חבר מקבוצה
router.delete('/:id/members/:userId', (req, res) => {
  const groupId = Number(req.params.id);
  const userId = Number(req.params.userId);
  if (!isGroupManager(req.user.id, groupId)) {
    return res.status(403).json({ error: 'רק מנהל השבתה של הקבוצה יכול להסיר חברים' });
  }
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);
  audit(req.user.id, 'remove_member', 'group', groupId, String(userId));
  res.json({ ok: true });
});

// מחיקת קבוצה (admin בלבד — פעולה הרסנית שמוחקת גם השבתות)
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'רק מנהל מערכת יכול למחוק קבוצה' });
  const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(id);
  if (!group) return res.status(404).json({ error: 'קבוצה לא נמצאה' });
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  audit(req.user.id, 'delete_group', 'group', id, group.name);
  res.json({ ok: true });
});

export default router;
