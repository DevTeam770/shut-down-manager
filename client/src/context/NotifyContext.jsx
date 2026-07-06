import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useSocket } from './SocketContext.jsx';
import { useAuth } from './AuthContext.jsx';
import { api } from '../api/client.js';

// ניהול התראות: Toasts קופצים בזמן אמת + מונה שלא-נקראו + Browser Notifications
const NotifyContext = createContext(null);

let toastId = 0;

export function NotifyProvider({ children }) {
  const { socket } = useSocket() || {};
  const { user } = useAuth();
  const [toasts, setToasts] = useState([]);
  const [unread, setUnread] = useState(0);

  const dismissToast = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  const pushToast = useCallback((toast) => {
    const id = ++toastId;
    setToasts(t => [...t.slice(-4), { ...toast, id }]); // עד 5 בו-זמנית
    // התראה שדורשת תגובה נשארת עד טיפול; אחרת נעלמת אחרי 8 שניות
    if (!toast.needs_response) {
      setTimeout(() => dismissToast(id), 8000);
    }
    return id;
  }, [dismissToast]);

  // טעינת מונה ראשוני
  useEffect(() => {
    if (!user) { setUnread(0); return; }
    api.get('/api/notifications').then(d => setUnread(d.unread)).catch(() => {});
  }, [user?.id]);

  // האזנה להתראות בזמן אמת
  useEffect(() => {
    if (!socket) return;
    const onNotify = (n) => {
      setUnread(u => u + 1);
      pushToast({
        title: n.kind === 'new_shutdown' ? '📢 השבתה חדשה' : '🔔 עדכון',
        body: n.body,
        shutdown_id: n.shutdown_id,
        needs_response: !!n.needs_response
      });
      // Browser Notification כשהטאב ברקע
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('מערכת ניהול השבתות', { body: n.body });
      }
    };
    socket.on('notify', onNotify);
    return () => socket.off('notify', onNotify);
  }, [socket, pushToast]);

  // בקשת הרשאה ל-Browser Notifications פעם אחת
  useEffect(() => {
    if (user && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [user?.id]);

  return (
    <NotifyContext.Provider value={{ toasts, pushToast, dismissToast, unread, setUnread }}>
      {children}
    </NotifyContext.Provider>
  );
}

export const useNotify = () => useContext(NotifyContext);
