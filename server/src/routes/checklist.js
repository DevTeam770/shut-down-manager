// צ'קליסט להשבתה: משימות לפני / במהלך / אחרי.
// מנהל השבתה מוסיף ומוחק; כל חבר קבוצה מסמן ביצוע (מי שעשה — מסמן).
import { Router } from 'express';
import { z } from 'zod';
import db, { audit } from '../db/db.js';
import { requireAuth, validate, isGroupManager, isGroupMember } from '../middleware/auth.js';
import { emitShutdownUpdate, systemMessage } from '../services/events.js';

const router = Router();
router.use(requireAuth);

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

// הוספת פריט (מנהל)
router.post('/:id/checklist', validate(z.object({
  text: z.string().trim().min(1, 'טקסט המשימה ריק').max(300),
  phase: z.enum(['before', 'during', 'after']).default('before')
})), (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  if (!isGroupManager(req.user.id, shutdown.group_id)) {
    return res.status(403).json({ error: 'רק מנהל השבתה יכול להוסיף משימות' });
  }
  const pos = db.prepare(
    'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM checklist_items WHERE shutdown_id = ? AND phase = ?'
  ).get(shutdown.id, req.body.phase).p;
  const info = db.prepare(
    'INSERT INTO checklist_items (shutdown_id, text, phase, position) VALUES (?, ?, ?, ?)'
  ).run(shutdown.id, req.body.text, req.body.phase, pos);
  audit(req.user.id, 'add_checklist_item', 'shutdown', shutdown.id, req.body.text);
  emitShutdownUpdate(shutdown.id);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// סימון/ביטול ביצוע (כל חבר קבוצה)
router.patch('/:id/checklist/:itemId', validate(z.object({
  done: z.boolean()
})), (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  const item = db.prepare('SELECT * FROM checklist_items WHERE id = ? AND shutdown_id = ?')
    .get(Number(req.params.itemId), shutdown.id);
  if (!item) return res.status(404).json({ error: 'משימה לא נמצאה' });

  if (req.body.done) {
    db.prepare(`UPDATE checklist_items SET done = 1, done_by = ?, done_at = datetime('now') WHERE id = ?`)
      .run(req.user.id, item.id);
    // כשההשבתה בביצוע — סימון משימה מדווח בצ'אט כדי שכולם יראו התקדמות
    if (shutdown.status === 'in_progress') {
      systemMessage(shutdown.id, `☑️ ${req.user.display_name} סימן/ה כבוצע: ${item.text}`);
    }
  } else {
    db.prepare('UPDATE checklist_items SET done = 0, done_by = NULL, done_at = NULL WHERE id = ?').run(item.id);
  }
  emitShutdownUpdate(shutdown.id);
  res.json({ ok: true });
});

// מחיקת פריט (מנהל)
router.delete('/:id/checklist/:itemId', (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  if (!isGroupManager(req.user.id, shutdown.group_id)) {
    return res.status(403).json({ error: 'רק מנהל השבתה יכול למחוק משימות' });
  }
  db.prepare('DELETE FROM checklist_items WHERE id = ? AND shutdown_id = ?')
    .run(Number(req.params.itemId), shutdown.id);
  emitShutdownUpdate(shutdown.id);
  res.json({ ok: true });
});

export default router;
