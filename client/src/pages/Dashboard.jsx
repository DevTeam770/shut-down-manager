import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { fmtDate, STATUS_LABELS, STATUS_BADGE } from '../utils/format.js';
import RespondButtons from '../components/RespondButtons.jsx';

const HEB_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

// גרף עמודות: השבתות לפי חודש. סדרה אחת בצבע המערכת, קווי-רשת עדינים,
// מילוי 6 חודשים רצופים (כולל ריקים), תוויות חודש בעברית. dataviz-compliant.
function MonthChart({ data }) {
  // מילוי רצף 6 החודשים האחרונים גם אם חסרים ב-data
  const byMonth = Object.fromEntries(data.map(d => [d.month, d.c]));
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: `${HEB_MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`, c: byMonth[key] || 0 });
  }
  const max = Math.max(...months.map(m => m.c), 1);
  // תוויות ציר: מקסימום, אמצע, 0
  const ticks = [max, Math.round(max / 2), 0].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="month-chart" role="img"
      aria-label={`השבתות לפי חודש: ${months.map(m => `${m.label} — ${m.c}`).join(', ')}`}>
      <div className="mc-yaxis">
        {ticks.map(t => <div key={t} className="mc-tick"><span>{t}</span></div>)}
      </div>
      <div className="mc-plot">
        <div className="mc-grid">
          {ticks.map(t => <div key={t} className="mc-gridline" />)}
        </div>
        <div className="mc-cols">
          {months.map(m => (
            <div className="mc-col" key={m.key} title={`${m.label}: ${m.c} השבתות`}>
              <div className="mc-bar-area">
                {m.c > 0 && <div className="mc-value">{m.c}</div>}
                <div className="mc-bar" style={{ height: `${(100 * m.c) / max}%` }} />
              </div>
              <div className="mc-label">{m.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [shutdowns, setShutdowns] = useState(null);
  const [stats, setStats] = useState(null);

  const load = () => {
    api.get('/api/shutdowns').then(d => setShutdowns(d.shutdowns)).catch(() => setShutdowns([]));
    api.get('/api/stats').then(setStats).catch(() => {});
  };
  useEffect(load, []);

  if (!shutdowns) {
    return <div className="skeleton" style={{ height: 260 }} />;
  }

  const active = shutdowns.filter(s => !['completed', 'cancelled'].includes(s.status));
  const needMyResponse = active.filter(s => !s.my_response && !s.is_final_date);
  const upcoming = [...active].sort((a, b) => a.proposed_date.localeCompare(b.proposed_date)).slice(0, 5);

  return (
    <>
      <h1>שלום, {user.display_name} 👋</h1>

      {stats && (
        <div className={user.role === 'admin' ? 'grid-3' : 'grid-2'} style={{ marginBottom: 16 }}>
          <div className="card stat-tile">
            <div className="num" style={{ color: 'var(--orange)' }}>{stats.pendingMine}</div>
            <div className="lbl">ממתינות לתגובתך</div>
          </div>
          <div className="card stat-tile">
            <div className="num" style={{ color: 'var(--primary)' }}>{active.length}</div>
            <div className="lbl">השבתות פעילות</div>
          </div>
          {/* ציון ממוצע — דוח הנהלה (admin) בלבד */}
          {user.role === 'admin' && (
            <div className="card stat-tile">
              <div className="num" style={{ color: 'var(--green)' }}>{stats.avgScore ?? '—'}</div>
              <div className="lbl">ציון ממוצע להשבתות</div>
            </div>
          )}
        </div>
      )}

      {needMyResponse.length > 0 && (
        <div className="card" style={{ borderRight: '4px solid var(--orange)' }}>
          <h2>⏳ ממתינות לתגובתך</h2>
          {needMyResponse.map(s => (
            <div key={s.id} className="row spread" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <Link to={`/shutdowns/${s.id}`} style={{ fontWeight: 700 }}>{s.title}</Link>
                <div className="muted">{s.group_name} · {fmtDate(s.proposed_date)}{s.start_time ? ` · ${s.start_time}` : ''}</div>
              </div>
              <RespondButtons compact shutdownId={s.id} onDone={load} />
            </div>
          ))}
        </div>
      )}

      {user.role === 'admin' && stats?.byMonth?.length > 0 && (
        <div className="card">
          <div className="row spread">
            <h2>השבתות לפי חודש</h2>
            <a className="btn btn-ghost btn-sm" href="/api/stats/export.csv" download
              title="הורדת דוח מלא: כל ההשבתות, ציונים ולקחים (נפתח ב-Excel)">
              ⬇️ ייצוא דוח CSV
            </a>
          </div>
          <MonthChart data={stats.byMonth} />
        </div>
      )}

      <div className="card">
        <div className="row spread">
          <h2>השבתות קרובות</h2>
          <Link to="/shutdowns" className="btn btn-ghost btn-sm">לכל ההשבתות ←</Link>
        </div>
        {upcoming.length === 0 && <p className="muted">אין השבתות פעילות כרגע.</p>}
        {upcoming.map(s => (
          <div key={s.id} className="row spread" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1 }}>
              <div className="row">
                <Link to={`/shutdowns/${s.id}`} style={{ fontWeight: 700 }}>{s.title}</Link>
                <span className={`badge ${s.is_final_date ? 'badge-green' : 'badge-orange'}`}>
                  {s.is_final_date ? '🟢 תאריך סופי' : '🟠 תאריך מוצע'}
                </span>
                <span className={`badge ${STATUS_BADGE[s.status]}`}>{STATUS_LABELS[s.status]}</span>
              </div>
              <div className="muted">{s.group_name} · {fmtDate(s.proposed_date)}</div>
            </div>
            <div style={{ width: 160 }}>
              <div className="muted" style={{ textAlign: 'left' }}>{s.approved_count}/{s.member_count} אישרו</div>
              <div className="progress"><div style={{ width: `${s.member_count ? (100 * s.approved_count / s.member_count) : 0}%` }} /></div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
