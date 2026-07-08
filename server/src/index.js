import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';

import config from './config.js';
import logger from './logger.js';
import db, { backupDatabase } from './db/db.js';
import { setIo } from './services/events.js';
import { minuteTick } from './services/scheduler.js';
import setupSockets from './sockets/chat.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import groupRoutes from './routes/groups.js';
import shutdownRoutes from './routes/shutdowns.js';
import fileRoutes from './routes/files.js';
import checklistRoutes from './routes/checklist.js';
import searchRoutes from './routes/search.js';
import notificationRoutes from './routes/notifications.js';
import calendarRoutes from './routes/calendar.js';
import statsRoutes from './routes/stats.js';
import auditRoutes from './routes/audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server); // same-origin — אין צורך ב-CORS
setIo(io);
setupSockets(io);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc: ["'self'"]
    }
  }
}));
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/shutdowns', fileRoutes); // קבצים — לפני ה-routes הכלליים של השבתות
app.use('/api/shutdowns', checklistRoutes);
app.use('/api/shutdowns', shutdownRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/audit', auditRoutes);

// בריאות המערכת — לניטור פנימי
const startedAt = Date.now();
app.get('/api/health', (req, res) => {
  let dbOk = false;
  try { db.prepare('SELECT 1').get(); dbOk = true; } catch { /* db down */ }
  res.status(dbOk ? 200 : 500).json({
    ok: dbOk,
    uptime_sec: Math.round((Date.now() - startedAt) / 1000),
    version: '1.0.0'
  });
});

// הגשת הקליינט הבנוי (פרודקשן) — תהליך אחד לפריסה ברשת סגורה
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// טיפול אחיד בשגיאות
app.use((err, req, res, next) => {
  logger.error({ err: err.message, url: req.url }, 'unhandled error');
  res.status(500).json({ error: 'שגיאת שרת פנימית' });
});

// לולאת דקה: גיבוי לילי, תזכורות יומיות, מעברי סטטוס אוטומטיים
setInterval(() => minuteTick(backupDatabase), 60 * 1000);

server.listen(config.port, () => {
  logger.info(`מערכת ניהול השבתות פועלת: http://localhost:${config.port}`);
});

// כיבוי מסודר
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logger.info('מכבה שרת...');
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

export { app, server, io };
