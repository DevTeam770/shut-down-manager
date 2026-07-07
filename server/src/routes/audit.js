import { Router } from 'express';
import db from '../db/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// יומן פעולות — מנהלי מערכת בלבד. ה-audit נכתב בכל פעולה רגישה ברחבי השרת.
router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const entries = db.prepare(
    `SELECT a.*, COALESCE(u.display_name, '—') AS user_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT ?`
  ).all(limit);
  res.json({ entries });
});

export default router;
