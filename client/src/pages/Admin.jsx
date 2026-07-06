import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import { fmtDateTime } from '../utils/format.js';

// ניהול משתמשים — למנהלי מערכת (צוות פיתוח) בלבד
export default function Admin() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [modal, setModal] = useState(null); // { mode: 'new' } | { mode: 'edit', user }
  const [form, setForm] = useState({});
  const [error, setError] = useState('');

  const load = () => api.get('/api/users').then(d => setUsers(d.users)).catch(() => setUsers([]));
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setForm({ username: '', password: '', display_name: '', role: 'user' });
    setError('');
    setModal({ mode: 'new' });
  };
  const openEdit = (u) => {
    setForm({ password: '', display_name: u.display_name, role: u.role });
    setError('');
    setModal({ mode: 'edit', user: u });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (modal.mode === 'new') {
        await api.post('/api/users', form);
      } else {
        const body = { display_name: form.display_name, role: form.role };
        if (form.password) body.password = form.password;
        await api.patch(`/api/users/${modal.user.id}`, body);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeUser = async (u) => {
    if (!confirm(`למחוק את המשתמש ${u.display_name}? פעולה זו אינה הפיכה.`)) return;
    try {
      await api.del(`/api/users/${u.id}`);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  if (!users) return <div className="skeleton" style={{ height: 300 }} />;

  return (
    <>
      <div className="row spread" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>ניהול משתמשים</h1>
        <button className="btn btn-primary" onClick={openNew}>+ משתמש חדש</button>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>שם תצוגה</th>
              <th>שם משתמש</th>
              <th>תפקיד</th>
              <th>נוצר</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.display_name}{u.id === me.id && <span className="muted"> (אני)</span>}</td>
                <td className="muted">{u.username}</td>
                <td>
                  {u.role === 'admin'
                    ? <span className="badge badge-blue">מנהל מערכת</span>
                    : <span className="badge badge-gray">משתמש</span>}
                </td>
                <td className="muted">{fmtDateTime(u.created_at)}</td>
                <td style={{ textAlign: 'left' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>עריכה</button>
                  {u.id !== me.id && (
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeUser(u)}>מחיקה</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal.mode === 'new' ? 'משתמש חדש' : `עריכת ${modal.user.display_name}`} onClose={() => setModal(null)}>
          <form onSubmit={submit}>
            {modal.mode === 'new' && (
              <label className="field">
                <span>שם משתמש (אנגלית)</span>
                <input className="input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required autoFocus />
              </label>
            )}
            <label className="field">
              <span>שם תצוגה</span>
              <input className="input" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} required />
            </label>
            <label className="field">
              <span>{modal.mode === 'new' ? 'סיסמא' : 'איפוס סיסמא (השאירו ריק ללא שינוי)'}</span>
              <input className="input" type="password" value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required={modal.mode === 'new'} autoComplete="new-password" />
            </label>
            <label className="field">
              <span>תפקיד</span>
              <select className="select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="user">משתמש</option>
                <option value="admin">מנהל מערכת (צוות פיתוח)</option>
              </select>
            </label>
            {error && <div className="error-msg">{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>ביטול</button>
              <button className="btn btn-primary">שמירה</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
