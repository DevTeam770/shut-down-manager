import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import Modal from '../components/Modal.jsx';
import { fmtDateTime } from '../utils/format.js';

const ACTION_LABELS = {
  register: 'הרשמה', create_user: 'יצירת משתמש', update_user: 'עדכון משתמש', delete_user: 'מחיקת משתמש',
  change_password: 'שינוי סיסמא', create_group: 'יצירת קבוצה', delete_group: 'מחיקת קבוצה',
  add_member: 'הוספת חבר', remove_member: 'הסרת חבר', create_shutdown: 'יצירת השבתה',
  update_shutdown: 'עדכון השבתה', respond: 'תגובה להשבתה', adopt_date: 'אימוץ תאריך חלופי',
  resolve_condition: 'סימון תנאי כנפתר', review: 'סיכום השבתה', upload_files: 'העלאת קבצים', delete_file: 'מחיקת קובץ'
};

// ניהול משתמשים — למנהלי מערכת (צוות פיתוח) בלבד
export default function Admin() {
  const { user: me } = useAuth();
  const confirm = useConfirm();
  const [users, setUsers] = useState(null);
  const [modal, setModal] = useState(null); // { mode: 'new' } | { mode: 'edit', user }
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [tab, setTab] = useState('users');
  const [auditEntries, setAuditEntries] = useState(null);

  const load = () => api.get('/api/users').then(d => setUsers(d.users)).catch(() => setUsers([]));
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (tab === 'audit' && !auditEntries) {
      api.get('/api/audit').then(d => setAuditEntries(d.entries)).catch(() => setAuditEntries([]));
    }
  }, [tab]);

  const openNew = () => {
    setForm({ username: '', password: '', display_name: '', email: '', role: 'user' });
    setError('');
    setModal({ mode: 'new' });
  };
  const openEdit = (u) => {
    setForm({ password: '', display_name: u.display_name, email: u.email || '', role: u.role });
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
        const body = { display_name: form.display_name, email: form.email, role: form.role };
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
    if (!await confirm({ title: 'מחיקת משתמש', body: `למחוק את המשתמש ${u.display_name}?`, danger: true, confirmLabel: 'מחיקה' })) return;
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
        <div className="row">
          <h1 style={{ margin: 0 }}>ניהול</h1>
          <button className={`btn btn-sm ${tab === 'users' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('users')}>משתמשים</button>
          <button className={`btn btn-sm ${tab === 'audit' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('audit')}>יומן פעולות</button>
        </div>
        {tab === 'users' && <button className="btn btn-primary" onClick={openNew}>+ משתמש חדש</button>}
      </div>

      {tab === 'audit' && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          {!auditEntries ? <div className="skeleton" style={{ height: 200, margin: 16 }} /> : (
            <table className="table">
              <thead>
                <tr><th>מתי</th><th>מי</th><th>פעולה</th><th>פרטים</th></tr>
              </thead>
              <tbody>
                {auditEntries.length === 0 && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 24 }}>אין רשומות</td></tr>
                )}
                {auditEntries.map(e => (
                  <tr key={e.id}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</td>
                    <td style={{ fontWeight: 600 }}>{e.user_name}</td>
                    <td><span className="badge badge-gray">{ACTION_LABELS[e.action] || e.action}</span></td>
                    <td className="muted" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.details}>
                      {e.entity}#{e.entity_id} {e.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'users' && (
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
      )}

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
              <span>כתובת מייל (רשות — להתראות במייל כשה-SMTP מוגדר)</span>
              <input className="input" type="email" dir="ltr" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
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
