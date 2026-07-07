import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { useNotify } from '../context/NotifyContext.jsx';
import { api } from '../api/client.js';
import { fmtDateTime } from '../utils/format.js';
import RespondButtons from './RespondButtons.jsx';
import ActiveBanner from './ActiveBanner.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const { connected } = useSocket() || {};
  const { toasts, dismissToast, unread, setUnread } = useNotify();
  const navigate = useNavigate();
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  };

  const openBell = async () => {
    if (!bellOpen) {
      const d = await api.get('/api/notifications');
      setNotifications(d.notifications);
      setBellOpen(true);
      if (d.unread > 0) {
        await api.post('/api/notifications/read-all');
        setUnread(0);
      }
    } else {
      setBellOpen(false);
    }
  };

  // סגירת פאנל ההתראות בלחיצה מחוץ
  useEffect(() => {
    if (!bellOpen) return;
    const close = (e) => {
      if (!e.target.closest('.notif-panel') && !e.target.closest('.bell')) setBellOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [bellOpen]);

  return (
    <div className="layout">
      {connected === false && <div className="offline-banner">⚠️ החיבור נותק — מתחבר מחדש...</div>}
      <ActiveBanner />
      <header className="topbar">
        <div className="brand">🔌 ניהול השבתות</div>
        <nav>
          <NavLink to="/" end>ראשי</NavLink>
          <NavLink to="/shutdowns">השבתות</NavLink>
          <NavLink to="/groups">קבוצות</NavLink>
          <NavLink to="/calendar">לוח שנה</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin">ניהול</NavLink>}
        </nav>
        <button className="bell" onClick={openBell} title="התראות">
          🔔
          {unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={toggleTheme} title="מצב תצוגה">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <span className="muted">{user?.display_name}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => logout().then(() => navigate('/login'))}>
          יציאה
        </button>
        {bellOpen && (
          <div className="notif-panel">
            {notifications.length === 0 && <div className="notif-item muted">אין התראות</div>}
            {notifications.map(n => (
              <div
                key={n.id}
                className={`notif-item ${n.read_at ? '' : 'unread'}`}
                onClick={() => {
                  setBellOpen(false);
                  if (n.shutdown_id) navigate(`/shutdowns/${n.shutdown_id}`);
                }}
              >
                <div>{n.body}</div>
                <div className="muted">{fmtDateTime(n.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </header>

      <main className="main">
        <Outlet />
      </main>

      {/* התראות קופצות */}
      <div className="toast-container">
        {toasts.map(t => (
          <div className="toast" key={t.id}>
            <div className="row spread">
              <div className="toast-title">{t.title}</div>
              <button className="btn btn-ghost btn-sm" onClick={() => dismissToast(t.id)}>✕</button>
            </div>
            <div>{t.body}</div>
            {t.needs_response && t.shutdown_id && (
              <div className="toast-actions">
                <RespondButtons compact shutdownId={t.shutdown_id} onDone={() => dismissToast(t.id)} />
              </div>
            )}
            {t.shutdown_id && (
              <div style={{ marginTop: 8 }}>
                <a onClick={() => { dismissToast(t.id); navigate(`/shutdowns/${t.shutdown_id}`); }} style={{ cursor: 'pointer' }}>
                  מעבר לדף ההשבתה ולדיון ←
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
