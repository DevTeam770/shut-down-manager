// קבצים מצורפים להשבתה:
// העלאה — מנהל השבתה של הקבוצה או admin; הורדה — כל חברי הקבוצה; מחיקה — מנהל.
// הקבצים נשמרים בדיסק בשם אקראי (uploads/<shutdownId>/<uuid>.<ext>), השם המקורי רק ב-DB.
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import db, { audit } from '../db/db.js';
import config from '../config.js';
import logger from '../logger.js';
import { requireAuth, isGroupManager, isGroupMember } from '../middleware/auth.js';
import { systemMessage, notifyUsers, groupMemberIds, emitShutdownUpdate } from '../services/events.js';

const router = Router();
router.use(requireAuth);

// סיומות הרצה חסומות — האתר משמש גם דפדפנים ברשת הארגונית
const BLOCKED_EXT = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1', '.psm1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.dll', '.jar', '.lnk', '.reg'
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(config.uploadDir, String(req.params.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 12);
      cb(null, `${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: config.maxFileMb * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.has(ext)) return cb(new Error(`סוג קובץ חסום (${ext})`));
    cb(null, true);
  }
});

// שליפת השבתה + בדיקת חברות (אותה קונבנציה כמו ב-shutdowns.js)
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

// multipart מפוענח רק אחרי שההרשאה אושרה — שלא ייכתב קובץ של משתמש לא מורשה
function requireManager(req, res, next) {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  if (!isGroupManager(req.user.id, shutdown.group_id)) {
    return res.status(403).json({ error: 'רק מנהל השבתה או מנהל מערכת יכולים להעלות קבצים' });
  }
  req.shutdown = shutdown;
  next();
}

// רשימת קבצים של השבתה
router.get('/:id/files', (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  const files = db.prepare(
    `SELECT a.id, a.original_name, a.mime, a.size, a.created_at, u.display_name AS uploaded_by
     FROM attachments a JOIN users u ON u.id = a.user_id
     WHERE a.shutdown_id = ? ORDER BY a.id`
  ).all(shutdown.id);
  res.json({ files, can_manage: isGroupManager(req.user.id, shutdown.group_id) });
});

// העלאת קבצים (עד 5 בבקשה)
router.post('/:id/files', requireManager, (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `קובץ גדול מדי (מקסימום ${config.maxFileMb}MB)`
        : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.files?.length) return res.status(400).json({ error: 'לא נבחרו קבצים' });

    const count = db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE shutdown_id = ?').get(req.shutdown.id).c;
    if (count + req.files.length > config.maxFilesPerShutdown) {
      for (const f of req.files) fs.unlinkSync(f.path);
      return res.status(400).json({ error: `חריגה ממכסת הקבצים להשבתה (${config.maxFilesPerShutdown})` });
    }

    const insert = db.prepare(
      `INSERT INTO attachments (shutdown_id, user_id, original_name, stored_name, mime, size)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const names = [];
    for (const f of req.files) {
      // multer מפענח שמות קבצים כ-latin1 — שחזור UTF-8 לשמות בעברית
      const original = Buffer.from(f.originalname, 'latin1').toString('utf8');
      insert.run(req.shutdown.id, req.user.id, original, f.filename, f.mimetype || '', f.size);
      names.push(original);
    }

    audit(req.user.id, 'upload_files', 'shutdown', req.shutdown.id, names.join(', '));
    systemMessage(req.shutdown.id, `📎 ${req.user.display_name} צירף/ה ${names.length > 1 ? `${names.length} קבצים` : 'קובץ'}: ${names.join(', ')}`);
    notifyUsers(groupMemberIds(req.shutdown.id, req.user.id), {
      kind: 'files',
      body: `צורפו קבצים להשבתה "${req.shutdown.title}": ${names.join(', ')}`,
      shutdownId: req.shutdown.id
    });
    emitShutdownUpdate(req.shutdown.id);
    res.status(201).json({ ok: true, count: req.files.length });
  });
});

// הורדת קובץ — תמיד כ-attachment (לא מורץ בדפדפן)
router.get('/:id/files/:fileId', (req, res) => {
  const shutdown = loadShutdown(req, res);
  if (!shutdown) return;
  const file = db.prepare('SELECT * FROM attachments WHERE id = ? AND shutdown_id = ?')
    .get(Number(req.params.fileId), shutdown.id);
  if (!file) return res.status(404).json({ error: 'קובץ לא נמצא' });

  const filePath = path.join(config.uploadDir, String(shutdown.id), file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'הקובץ אינו קיים יותר בדיסק' });
  res.download(filePath, file.original_name);
});

// מחיקת קובץ — מנהל השבתה / admin
router.delete('/:id/files/:fileId', requireManager, (req, res) => {
  const file = db.prepare('SELECT * FROM attachments WHERE id = ? AND shutdown_id = ?')
    .get(Number(req.params.fileId), req.shutdown.id);
  if (!file) return res.status(404).json({ error: 'קובץ לא נמצא' });

  db.prepare('DELETE FROM attachments WHERE id = ?').run(file.id);
  try {
    fs.unlinkSync(path.join(config.uploadDir, String(req.shutdown.id), file.stored_name));
  } catch (e) {
    logger.warn({ file: file.stored_name }, 'קובץ לא נמצא בדיסק בעת מחיקה');
  }
  audit(req.user.id, 'delete_file', 'shutdown', req.shutdown.id, file.original_name);
  systemMessage(req.shutdown.id, `🗑️ ${req.user.display_name} מחק/ה את הקובץ: ${file.original_name}`);
  emitShutdownUpdate(req.shutdown.id);
  res.json({ ok: true });
});

export default router;
