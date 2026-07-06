import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Modal from '../components/Modal.jsx';

export default function Groups() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState('');

  const load = (query = '') => {
    api.get(`/api/groups${query ? `?q=${encodeURIComponent(query)}` : ''}`).then(setData).catch(() => {});
  };
  useEffect(() => load(), []);

  // חיפוש עם debounce קצר
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const createGroup = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/api/groups', form);
      setShowNew(false);
      setForm({ name: '', description: '' });
      load(q);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!data) return <div className="skeleton" style={{ height: 300 }} />;

  const notFound = q && !data.groups.some(g => g.name.includes(q));

  return (
    <>
      <div className="row spread" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>קבוצות</h1>
        {data.can_create && (
          <button className="btn btn-primary" onClick={() => { setForm(f => ({ ...f, name: q })); setShowNew(true); }}>
            + קבוצה חדשה
          </button>
        )}
      </div>

      <input
        className="input"
        style={{ marginBottom: 16 }}
        placeholder="🔍 חיפוש קבוצה בשם..."
        value={q}
        onChange={e => setQ(e.target.value)}
      />

      {notFound && (
        <div className="card" style={{ borderRight: '4px solid var(--orange)', marginBottom: 16 }}>
          לא נמצאה קבוצה בשם "{q}".
          {data.can_create && <> אפשר <a style={{ cursor: 'pointer' }} onClick={() => { setForm(f => ({ ...f, name: q })); setShowNew(true); }}>ליצור אותה עכשיו</a>.</>}
        </div>
      )}

      <div className="grid-3">
        {data.groups.map(g => (
          <Link to={`/groups/${g.id}`} key={g.id} className="card" style={{ color: 'inherit' }}>
            <div className="row spread">
              <h3 style={{ margin: 0 }}>{g.name}</h3>
              {!!g.is_manager && <span className="badge badge-blue">מנהל השבתה</span>}
            </div>
            {g.description && <p className="muted" style={{ margin: '6px 0' }}>{g.description}</p>}
            <div className="muted">👥 {g.member_count} חברים</div>
          </Link>
        ))}
        {data.groups.length === 0 && !q && <p className="muted">אינך חבר/ה באף קבוצה עדיין.</p>}
      </div>

      {showNew && (
        <Modal title="קבוצה חדשה" onClose={() => setShowNew(false)}>
          <form onSubmit={createGroup}>
            <label className="field">
              <span>שם הקבוצה / הרשת</span>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus />
            </label>
            <label className="field">
              <span>תיאור (רשות)</span>
              <textarea className="textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </label>
            {error && <div className="error-msg">{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>ביטול</button>
              <button className="btn btn-primary">יצירה</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
