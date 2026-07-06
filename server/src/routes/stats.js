import { Router } from 'express';
import db from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// סטטיסטיקות לדשבורד — בהיקף הקבוצות של המשתמש (admin: הכול)
router.get('/', (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const scope = isAdmin
    ? ''
    : `AND EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = s.group_id AND m.user_id = ${Number(req.user.id)})`;

  const byStatus = db.prepare(
    `SELECT status, COUNT(*) AS c FROM shutdowns s WHERE 1=1 ${scope} GROUP BY status`
  ).all();

  const avgScore = db.prepare(
    `SELECT ROUND(AVG(r.score), 1) AS avg FROM shutdown_reviews r JOIN shutdowns s ON s.id = r.shutdown_id WHERE 1=1 ${scope}`
  ).get().avg;

  const byMonth = db.prepare(
    `SELECT substr(proposed_date, 1, 7) AS month, COUNT(*) AS c FROM shutdowns s
     WHERE proposed_date >= date('now', '-6 months') ${scope} GROUP BY month ORDER BY month`
  ).all();

  // ממתינות לתגובה שלי
  const pendingMine = db.prepare(
    `SELECT COUNT(*) AS c FROM shutdowns s
     WHERE s.status IN ('proposed', 'confirmed') AND s.is_final_date = 0
       AND EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = s.group_id AND m.user_id = ?)
       AND NOT EXISTS(SELECT 1 FROM approvals a WHERE a.shutdown_id = s.id AND a.user_id = ?)`
  ).get(req.user.id, req.user.id).c;

  res.json({ byStatus, avgScore, byMonth, pendingMine });
});

export default router;
