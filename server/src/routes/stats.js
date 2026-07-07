import { Router } from 'express';
import db from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';
import { STATUS_LABELS } from '../services/shutdowns.js';

const router = Router();
router.use(requireAuth);

// ייצוא CSV של היסטוריית ההשבתות (בהיקף הקבוצות של המשתמש; admin — הכול)
router.get('/export.csv', (req, res) => {
  const base = `
    SELECT s.id, s.title, g.name AS group_name, s.proposed_date, s.start_time, s.end_time,
      s.status, s.is_final_date, u.display_name AS created_by_name,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id = s.group_id) AS member_count,
      (SELECT COUNT(*) FROM approvals a WHERE a.shutdown_id = s.id AND a.response = 'approved') AS approved_count,
      r.score, r.summary, r.lessons
    FROM shutdowns s
    JOIN groups g ON g.id = s.group_id
    JOIN users u ON u.id = s.created_by
    LEFT JOIN shutdown_reviews r ON r.shutdown_id = s.id`;
  const rows = req.user.role === 'admin'
    ? db.prepare(`${base} ORDER BY s.proposed_date DESC`).all()
    : db.prepare(
        `${base} WHERE EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = s.group_id AND m.user_id = ?)
         ORDER BY s.proposed_date DESC`
      ).all(req.user.id);

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['מזהה', 'כותרת', 'קבוצה', 'תאריך', 'שעת התחלה', 'שעת סיום', 'סטטוס', 'תאריך סופי', 'נוצרה ע"י', 'אישרו', 'חברים', 'ציון', 'סיכום', 'לקחים'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.id, r.title, r.group_name, r.proposed_date, r.start_time, r.end_time,
      STATUS_LABELS[r.status] || r.status, r.is_final_date ? 'כן' : 'לא', r.created_by_name,
      r.approved_count, r.member_count, r.score ?? '', r.summary ?? '', r.lessons ?? ''
    ].map(esc).join(','));
  }
  // BOM (﻿) כדי ש-Excel יזהה עברית (UTF-8)
  const BOM = String.fromCharCode(0xFEFF);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename=shutdowns-report.csv');
  res.send(BOM + lines.join('\r\n'));
});

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
