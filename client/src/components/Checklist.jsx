import { useState } from 'react';
import { api } from '../api/client.js';

const PHASES = [
  ['before', '🔵 לפני ההשבתה'],
  ['during', '🟠 במהלך ההשבתה'],
  ['after', '🟢 אחרי ההשבתה']
];

// צ'קליסט משימות להשבתה: מנהל מוסיף/מוחק, כל חבר קבוצה מסמן ביצוע.
// items מגיע מ-getShutdownFull; onChange מרענן את הדף (העדכון החי דרך shutdown:updated).
export default function Checklist({ shutdownId, items, isManager, isAdmin, onChange }) {
  const [newText, setNewText] = useState('');
  const [newPhase, setNewPhase] = useState('before');
  const [newAdminOnly, setNewAdminOnly] = useState(false);
  const [error, setError] = useState('');

  if (!isManager && items.length === 0) return null;

  const doneCount = items.filter(i => i.done).length;

  const add = async (e) => {
    e.preventDefault();
    if (!newText.trim()) return;
    setError('');
    try {
      await api.post(`/api/shutdowns/${shutdownId}/checklist`, {
        text: newText.trim(), phase: newPhase, admin_only: newAdminOnly
      });
      setNewText('');
      setNewAdminOnly(false);
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggle = async (item) => {
    setError('');
    try {
      await api.patch(`/api/shutdowns/${shutdownId}/checklist/${item.id}`, { done: !item.done });
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (item) => {
    setError('');
    try {
      await api.del(`/api/shutdowns/${shutdownId}/checklist/${item.id}`);
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="card">
      <div className="row spread">
        <h2>✅ צ'קליסט</h2>
        {items.length > 0 && <span className="muted">{doneCount}/{items.length} בוצעו</span>}
      </div>
      {items.length > 0 && (
        <div className="progress" style={{ marginBottom: 12 }}>
          <div style={{ width: `${(100 * doneCount) / items.length}%` }} />
        </div>
      )}

      {PHASES.map(([phase, label]) => {
        const phaseItems = items.filter(i => i.phase === phase);
        if (!phaseItems.length) return null;
        return (
          <div key={phase} style={{ marginBottom: 10 }}>
            <div className="muted" style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
            {phaseItems.map(item => (
              <div key={item.id} className="row spread" style={{ padding: '4px 0' }}>
                <label className="row" style={{ gap: 8, cursor: 'pointer', flex: 1 }}>
                  <input type="checkbox" checked={!!item.done} onChange={() => toggle(item)} />
                  <span style={item.done ? { textDecoration: 'line-through', color: 'var(--text-dim)' } : undefined}>
                    {item.text}
                  </span>
                  {!!item.admin_only && <span className="badge badge-gray" title="גלוי רק למנהלי מערכת">🔒 פרטי</span>}
                  {!!item.done && item.done_by_name && (
                    <span className="muted" style={{ fontSize: '.78rem' }}>✔ {item.done_by_name}</span>
                  )}
                </label>
                {isManager && (
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} title="מחיקה"
                    onClick={() => remove(item)}>✕</button>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {items.length === 0 && <p className="muted">אין משימות עדיין.</p>}

      {isManager && (
        <form className="row" onSubmit={add} style={{ marginTop: 8 }}>
          <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="משימה חדשה..."
            value={newText} onChange={e => setNewText(e.target.value)} maxLength={300} />
          <select className="select" style={{ width: 'auto' }} value={newPhase} onChange={e => setNewPhase(e.target.value)}>
            <option value="before">לפני</option>
            <option value="during">במהלך</option>
            <option value="after">אחרי</option>
          </select>
          {isAdmin && (
            <label className="row" style={{ gap: 4 }} title="הפריט יוצג רק למנהלי מערכת">
              <input type="checkbox" checked={newAdminOnly} onChange={e => setNewAdminOnly(e.target.checked)} />
              🔒 פרטי
            </label>
          )}
          <button className="btn btn-primary btn-sm" disabled={!newText.trim()}>+ הוספה</button>
        </form>
      )}
      {error && <div className="error-msg">{error}</div>}
    </div>
  );
}
