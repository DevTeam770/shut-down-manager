import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useSocket } from '../context/SocketContext.jsx';

// באנר אדום קבוע בראש האתר כשיש השבתה בביצוע כרגע, עם טיימר מאז ההתחלה
export default function ActiveBanner() {
  const { socket } = useSocket() || {};
  const navigate = useNavigate();
  const [active, setActive] = useState([]);
  const [, tick] = useState(0);

  const load = () => api.get('/api/shutdowns/active-now').then(d => setActive(d.active)).catch(() => {});

  useEffect(() => { load(); }, []);

  // רענון כשמשהו משתנה (התראות סטטוס מגיעות לכל חברי הקבוצה)
  useEffect(() => {
    if (!socket) return;
    const onNotify = (n) => { if (n.kind === 'status' || n.kind === 'overdue_end') load(); };
    socket.on('notify', onNotify);
    return () => socket.off('notify', onNotify);
  }, [socket]);

  // עדכון הטיימר כל 30 שניות
  useEffect(() => {
    if (!active.length) return;
    const t = setInterval(() => tick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, [active.length]);

  if (!active.length) return null;

  const elapsed = (s) => {
    if (!s.start_time) return '';
    const start = new Date(`${s.proposed_date}T${s.start_time}`);
    const mins = Math.max(0, Math.round((Date.now() - start) / 60000));
    if (mins < 60) return ` · ${mins} דק'`;
    return ` · ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')} שעות`;
  };

  return (
    <div className="active-banner">
      {active.map(s => (
        <span key={s.id} onClick={() => navigate(`/shutdowns/${s.id}`)}>
          🔧 השבתה בביצוע כרגע: <strong>{s.title}</strong> ({s.group_name})
          {s.start_time && ` — החלה ב-${s.start_time}`}{elapsed(s)}
          {s.end_time && ` · סיום מתוכנן ${s.end_time}`}
        </span>
      ))}
    </div>
  );
}
