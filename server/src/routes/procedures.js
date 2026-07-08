// נהלי השבתות: מצגות ומסמכי הדרכה. מנהל מערכת מעלה/מוחק; כל המשתמשים צופים ומורידים.
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import db, { audit } from '../db/db.js';
import config from '../config.js';
import logger from '../logger.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const BLOCKED_EXT = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1', '.psm1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.dll', '.jar', '.lnk', '.reg'
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(config.procedureDir, { recursive: true });
      cb(null, config.procedureDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 12);
      cb(null, `${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: config.maxFileMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.has(ext)) return cb(new Error(`סוג קובץ חסום (${ext})`));
    cb(null, true);
  }
});

// רשימת נהלים — לכל מחובר
router.get('/', (req, res) => {
  const docs = db.prepare(
    `SELECT p.id, p.title, p.original_name, p.mime, p.size, p.created_at, u.display_name AS uploaded_by
     FROM procedure_docs p JOIN users u ON u.id = p.uploaded_by ORDER BY p.id DESC`
  ).all();
  res.json({ docs, can_manage: req.user.role === 'admin' });
});

// העלאת נוהל — admin
router.post('/', requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `קובץ גדול מדי (מקסימום ${config.maxFileMb}MB)` : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ' });
    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const title = String(req.body.title || '').trim() || original;
    const info = db.prepare(
      'INSERT INTO procedure_docs (title, original_name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(title, original, req.file.filename, req.file.mimetype || '', req.file.size, req.user.id);
    audit(req.user.id, 'upload_procedure', 'procedure', Number(info.lastInsertRowid), title);
    res.status(201).json({ ok: true });
  });
});

// הורדה/תצוגה — כל מחובר. inline כדי לאפשר תצוגה מקדימה של PDF/תמונה ב-iframe.
router.get('/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM procedure_docs WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'קובץ לא נמצא' });
  const filePath = path.join(config.procedureDir, doc.stored_name);
  if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'הקובץ אינו קיים יותר בדיסק' });
  if (doc.mime) res.set('Content-Type', doc.mime);
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`);
  res.sendFile(filePath);
});

// מחיקה — admin
router.delete('/:id', requireAdmin, (req, res) => {
  const doc = db.prepare('SELECT * FROM procedure_docs WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'קובץ לא נמצא' });
  db.prepare('DELETE FROM procedure_docs WHERE id = ?').run(doc.id);
  try { fs.unlinkSync(path.join(config.procedureDir, doc.stored_name)); }
  catch { logger.warn({ file: doc.stored_name }, 'נוהל לא נמצא בדיסק בעת מחיקה'); }
  audit(req.user.id, 'delete_procedure', 'procedure', doc.id, doc.title);
  res.json({ ok: true });
});

export default router;
