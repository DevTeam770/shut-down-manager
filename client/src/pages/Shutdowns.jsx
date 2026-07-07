import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { fmtDate, STATUS_LABELS, STATUS_BADGE } from '../utils/format.js';
import NewShutdownModal from '../components/NewShutdownModal.jsx';

export default function Shutdowns() {
  const [shutdowns, setShutdowns] = useState(null);
  const [groups, setGroups] = useState([]);
  const [filter, setFilter] = useState('active');
  const [showArchive, setShowArchive] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const load = () => {
    api.get('/api/shutdowns').then(d => setShutdowns(d.shutdowns)).catch(() => setShutdowns([]));
    api.get('/api/groups').then(d => setGroups(d.groups.filter(g => g.is_manager || false))).catch(() => {});
  };
  useEffect(load, []);

  if (!shutdowns) return <div className="skeleton" style={{ height: 300 }} />;

  // ארכוב: "הסתיימו" מציג כברירת מחדל רק 3 חודשים אחרונים
  const archiveCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isDone = (s) => ['completed', 'cancelled'].includes(s.status);
  const filtered = shutdowns.filter(s =>
    filter === 'active' ? !isDone(s)
      : filter === 'done' ? isDone(s) && (showArchive || s.proposed_date >= archiveCutoff)
        : true
  );
  const archivedCount = filter === 'done' && !showArchive
    ? shutdowns.filter(s => isDone(s) && s.proposed_date < archiveCutoff).length
    : 0;

  return (
    <>
      <div className="row spread" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>השבתות</h1>
        <div className="row">
          <select className="select" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="active">פעילות</option>
            <option value="done">הסתיימו</option>
            <option value="all">הכול</option>
          </select>
          {filter === 'done' && (
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={showArchive} onChange={e => setShowArchive(e.target.checked)} />
              כולל ארכיון{archivedCount > 0 && ` (${archivedCount})`}
            </label>
          )}
          {groups.length > 0 && (
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ השבתה חדשה</button>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>השבתה</th>
              <th>קבוצה</th>
              <th>תאריך</th>
              <th>סטטוס</th>
              <th>אישורים</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>אין השבתות להצגה</td></tr>
            )}
            {filtered.map(s => (
              <tr key={s.id}>
                <td><Link to={`/shutdowns/${s.id}`} style={{ fontWeight: 700 }}>{s.title}</Link></td>
                <td>{s.group_name}</td>
                <td>
                  <span className={`badge ${s.is_final_date ? 'badge-green' : 'badge-orange'}`}>
                    {fmtDate(s.proposed_date)}{s.is_final_date ? ' 🟢' : ' 🟠'}
                  </span>
                </td>
                <td><span className={`badge ${STATUS_BADGE[s.status]}`}>{STATUS_LABELS[s.status]}</span></td>
                <td style={{ minWidth: 130 }}>
                  <div className="muted">{s.approved_count}/{s.member_count}</div>
                  <div className="progress"><div style={{ width: `${s.member_count ? 100 * s.approved_count / s.member_count : 0}%` }} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewShutdownModal
          groups={groups}
          history={shutdowns}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}
    </>
  );
}
