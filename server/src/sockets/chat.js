// חדר צ'אט לכל השבתה: shutdown:<id>
// אימות JWT מה-cookie בעת החיבור, הצטרפות רק לחברי הקבוצה,
// התמדה ב-DB לפני שידור, נעילת כתיבה כשההשבתה הסתיימה.
import db from '../db/db.js';
import { verifyToken, isGroupMember } from '../middleware/auth.js';
import { isChatOpen } from '../services/shutdowns.js';
import logger from '../logger.js';

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map(p => p.trim().split('=').map(decodeURIComponent)).filter(p => p.length === 2)
  );
}

export default function setupSockets(io) {
  // אימות בזמן handshake — לפני שה-socket נפתח
  io.use((socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const payload = verifyToken(cookies.token);
      const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(payload.id);
      if (!user) return next(new Error('unauthorized'));
      socket.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    // ערוץ אישי להתראות קופצות
    socket.join(`user:${socket.user.id}`);
    logger.debug({ user: socket.user.username }, 'socket connected');

    // הצטרפות לחדר השבתה
    socket.on('chat:join', (shutdownId, ack) => {
      const shutdown = db.prepare('SELECT id, group_id, status FROM shutdowns WHERE id = ?').get(Number(shutdownId));
      if (!shutdown || !isGroupMember(socket.user.id, shutdown.group_id)) {
        return ack?.({ error: 'אין גישה לחדר זה' });
      }
      const room = `shutdown:${shutdown.id}`;
      socket.join(room);
      // רשימת מחוברים לחדר
      emitPresence(io, room);
      ack?.({ ok: true, chat_open: isChatOpen(shutdown.status) });
    });

    socket.on('chat:leave', (shutdownId) => {
      const room = `shutdown:${Number(shutdownId)}`;
      socket.leave(room);
      emitPresence(io, room);
    });

    // שליחת הודעה — נשמרת ב-DB לפני שידור (רענון לא מאבד כלום)
    socket.on('chat:send', (data, ack) => {
      const shutdownId = Number(data?.shutdownId);
      const body = String(data?.body || '').trim().slice(0, 2000);
      if (!body) return ack?.({ error: 'הודעה ריקה' });

      const shutdown = db.prepare('SELECT id, group_id, status FROM shutdowns WHERE id = ?').get(shutdownId);
      if (!shutdown || !isGroupMember(socket.user.id, shutdown.group_id)) {
        return ack?.({ error: 'אין גישה לחדר זה' });
      }
      if (!isChatOpen(shutdown.status)) {
        return ack?.({ error: 'הצ\'אט נסגר — ההשבתה הסתיימה' });
      }

      const info = db.prepare(
        `INSERT INTO messages (shutdown_id, user_id, body, type) VALUES (?, ?, ?, 'text')`
      ).run(shutdownId, socket.user.id, body);
      const message = {
        ...db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid),
        display_name: socket.user.display_name
      };
      io.to(`shutdown:${shutdownId}`).emit('chat:message', message);
      ack?.({ ok: true, id: message.id }); // חיווי "נמסר" לשולח
    });

    // אינדיקציית הקלדה — לא נשמרת, רק משודרת לשאר החדר
    socket.on('chat:typing', (shutdownId) => {
      socket.to(`shutdown:${Number(shutdownId)}`).emit('chat:typing', {
        user_id: socket.user.id,
        display_name: socket.user.display_name
      });
    });

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('shutdown:')) {
          // אחרי שה-socket יעזוב בפועל
          setImmediate(() => emitPresence(io, room));
        }
      }
    });
  });
}

// שידור רשימת המחוברים בחדר (ללא כפילויות משתמש עם כמה טאבים)
function emitPresence(io, room) {
  const sockets = io.sockets.adapter.rooms.get(room) || new Set();
  const users = new Map();
  for (const sid of sockets) {
    const s = io.sockets.sockets.get(sid);
    if (s?.user) users.set(s.user.id, { id: s.user.id, display_name: s.user.display_name });
  }
  io.to(room).emit('chat:presence', [...users.values()]);
}
