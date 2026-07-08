import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { fmtDate, STATUS_LABELS } from '../utils/format.js';

// חיפוש גלובלי ב-topbar: השבתות, קבוצות, הודעות צ'אט וקבצים
export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); setOpen(false); return; }
    const t = setTimeout(() => {
      api.get(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then(d => { setResults(d); setOpen(true); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // סגירה בלחיצה בחוץ
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const go = (path) => {
    setOpen(false);
    setQ('');
    navigate(path);
  };

  const total = results
    ? results.shutdowns.length + results.groups.length + results.messages.length + results.files.length
    : 0;

  return (
    <div className="global-search" ref={boxRef}>
      <input
        className="input"
        placeholder="🔍 חיפוש..."
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => results && setOpen(true)}
      />
      {open && results && (
        <div className="search-panel">
          {total === 0 && <div className="notif-item muted">אין תוצאות עבור "{q}"</div>}

          {results.shutdowns.length > 0 && <div className="search-section">השבתות</div>}
          {results.shutdowns.map(s => (
            <div key={`s${s.id}`} className="notif-item" onClick={() => go(`/shutdowns/${s.id}`)}>
              🔌 <strong>{s.title}</strong>
              <div className="muted">{s.group_name} · {fmtDate(s.proposed_date)} · {STATUS_LABELS[s.status]}</div>
            </div>
          ))}

          {results.groups.length > 0 && <div className="search-section">קבוצות</div>}
          {results.groups.map(g => (
            <div key={`g${g.id}`} className="notif-item" onClick={() => go(`/groups/${g.id}`)}>
              👥 {g.name}
            </div>
          ))}

          {results.messages.length > 0 && <div className="search-section">הודעות צ'אט</div>}
          {results.messages.map(m => (
            <div key={`m${m.id}`} className="notif-item" onClick={() => go(`/shutdowns/${m.shutdown_id}`)}>
              💬 <strong>{m.display_name}</strong> ב"{m.shutdown_title}"
              <div className="muted">{m.body.slice(0, 70)}{m.body.length > 70 ? '…' : ''}</div>
            </div>
          ))}

          {results.files.length > 0 && <div className="search-section">קבצים</div>}
          {results.files.map(f => (
            <div key={`f${f.id}`} className="notif-item" onClick={() => go(`/shutdowns/${f.shutdown_id}`)}>
              📎 {f.original_name}
              <div className="muted">ב"{f.shutdown_title}"</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
