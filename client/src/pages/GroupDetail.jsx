import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useConfirm } from '../context/ConfirmContext.jsx';

export default function GroupDetail() {
  const { id } = useParams();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [asManager, setAsManager] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    api.get(`/api/groups/${id}`).then(setData).catch(e => setError(e.message));
  };
  useEffect(load, [id]);

  useEffect(() => {
    if (data?.is_manager) {
      api.get('/api/users').then(d => setAllUsers(d.users)).catch(() => {});
    }
  }, [data?.is_manager]);

  if (error) return <div className="card error-msg">{error}</div>;
  if (!data) return <div className="skeleton" style={{ height: 300 }} />;

  const { group, members, is_manager } = data;
  const memberIds = new Set(members.map(m => m.id));
  const addable = allUsers.filter(u => !memberIds.has(u.id));

  const addMember = async (e) => {
    e.preventDefault();
    if (!selectedUser) return;
    setError('');
    try {
      await api.post(`/api/groups/${id}/members`, { user_id: Number(selectedUser), is_shutdown_manager: asManager });
      setSelectedUser('');
      setAsManager(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleManager = async (m) => {
    try {
      await api.post(`/api/groups/${id}/members`, { user_id: m.id, is_shutdown_manager: !m.is_shutdown_manager });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeMember = async (m) => {
    if (!await confirm({ title: 'הסרת חבר', body: `להסיר את ${m.display_name} מהקבוצה?`, danger: true, confirmLabel: 'הסרה' })) return;
    try {
      await api.del(`/api/groups/${id}/members/${m.id}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 4 }}>
        <Link to="/groups">קבוצות</Link>
        <span className="muted">/</span>
        <h1 style={{ margin: 0 }}>{group.name}</h1>
      </div>
      {group.description && <p className="muted">{group.description}</p>}

      <div className="card">
        <h2>👥 חברי הקבוצה ({members.length})</h2>
        <table className="table">
          <thead>
            <tr>
              <th>שם</th>
              <th>שם משתמש</th>
              <th>תפקיד בקבוצה</th>
              {is_manager && <th></th>}
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id}>
                <td style={{ fontWeight: 600 }}>{m.display_name}</td>
                <td className="muted">{m.username}</td>
                <td>
                  {m.is_shutdown_manager
                    ? <span className="badge badge-blue">מנהל השבתה</span>
                    : <span className="badge badge-gray">חבר</span>}
                </td>
                {is_manager && (
                  <td style={{ textAlign: 'left' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleManager(m)}>
                      {m.is_shutdown_manager ? 'הסרת ניהול' : 'הפיכה למנהל השבתה'}
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeMember(m)}>
                      הסרה
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {is_manager && (
        <div className="card">
          <h2>➕ הוספת משתמש לקבוצה</h2>
          <form className="row" onSubmit={addMember}>
            <select className="select" style={{ flex: 1, minWidth: 200 }} value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
              <option value="">בחירת משתמש...</option>
              {addable.map(u => <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>)}
            </select>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={asManager} onChange={e => setAsManager(e.target.checked)} />
              מנהל השבתה
            </label>
            <button className="btn btn-primary" disabled={!selectedUser}>הוספה</button>
          </form>
          {error && <div className="error-msg">{error}</div>}
        </div>
      )}
    </>
  );
}
