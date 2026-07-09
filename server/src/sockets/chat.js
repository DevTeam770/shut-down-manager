// חדר צ'אט לכל השבתה: shutdown:<id>
// אימות JWT מה-cookie בעת החיבור, הצטרפות רק לחברי הקבוצה,
// התמדה ב-DB לפני שידור, נעילת כתיבה כשההשבתה הסתיימה.
import db from '../db/db.js';
import { verifyToken, isGroupMember, isGroupManager } from '../middleware/auth.js';
import { isChatOpen } from '../services/shutdowns.js';
import { notifyUsers } from '../services/events.js';
import { mailUsers } from '../services/mailer.js';
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
      socket.user = verifyToken(cookies.token); // כולל בדיקת revocation
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

      const shutdown = db.prepare('SELECT id, group_id, status, title FROM shutdowns WHERE id = ?').get(shutdownId);
      if (!shutdown || !isGroupMember(socket.user.id, shutdown.group_id)) {
        return ack?.({ error: 'אין גישה לחדר זה' });
      }
      if (!isChatOpen(shutdown.status)) {
        return ack?.({ error: 'הצ\'אט נסגר — ההשבתה הסתיימה' });
      }

      // הודעה פרטית: נמען ספציפי (רק למנהל/admin), חייב להיות חבר קבוצה
      let recipientId = Number(data?.recipientId) || null;
      const isManager = isGroupManager(socket.user.id, shutdown.group_id);
      if (recipientId) {
        if (!isManager || !isGroupMember(recipientId, shutdown.group_id)) recipientId = null;
      }

      const info = db.prepare(
        `INSERT INTO messages (shutdown_id, user_id, body, type, recipient_id) VALUES (?, ?, ?, 'text', ?)`
      ).run(shutdownId, socket.user.id, body, recipientId);
      const message = {
        ...db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid),
        display_name: socket.user.display_name,
        role: socket.user.role
      };

      if (recipientId) {
        // הודעה פרטית — רק לשולח ולנמען (ולמנהלי מערכת שמאזינים לערוץ האישי שלהם)
        io.to(`user:${socket.user.id}`).to(`user:${recipientId}`).emit('chat:message', message);
        notifyUsers([recipientId], {
          kind: 'private_msg',
          body: `🔒 הודעה פרטית מ${socket.user.display_name} בהשבתה "${shutdown.title}"`,
          shutdownId
        });
      } else {
        io.to(`shutdown:${shutdownId}`).emit('chat:message', message);
      }
      ack?.({ ok: true, id: message.id }); // חיווי "נמסר" לשולח

      // הודעת מנהל לכולם (לא פרטית) = הודעת מנהלה: התראה + מייל לחברי הקבוצה
      if (isManager && !recipientId) {
        const others = db.prepare(
          `SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?`
        ).all(shutdown.group_id, socket.user.id).map(r => r.user_id);
        if (others.length) {
          notifyUsers(others, {
            kind: 'manager_msg',
            body: `📢 הודעת מנהלה מ${socket.user.display_name} בהשבתה "${shutdown.title}": ${body.slice(0, 120)}`,
            shutdownId
          });
          // [INTEGRATION: closed-network] מייל דרך Exchange — פעיל כשה-SMTP מוגדר
          mailUsers(others, `הודעת מנהלה: ${shutdown.title}`, `${socket.user.display_name}:\n${body}`);
        }
      }

      // אזכורים: @שם תצוגה של חבר קבוצה ⇦ התראה אישית למאוזכר (בהודעה לכולם)
      if (!recipientId && body.includes('@')) {
        const members = db.prepare(
          `SELECT u.id, u.display_name FROM group_members m JOIN users u ON u.id = m.user_id
           WHERE m.group_id = ? AND u.id != ?`
        ).all(shutdown.group_id, socket.user.id);
        const mentioned = members.filter(u => body.includes(`@${u.display_name}`));
        if (mentioned.length) {
          notifyUsers(mentioned.map(u => u.id), {
            kind: 'mention',
            body: `💬 ${socket.user.display_name} איזכר/ה אותך בצ'אט של "${shutdown.title}": ${body.slice(0, 80)}`,
            shutdownId
          });
        }
      }
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
