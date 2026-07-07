import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

// יצירת השבתה חדשה — למנהלי השבתה בלבד (groups = הקבוצות שהמשתמש מנהל)
export default function NewShutdownModal({ groups, onClose, onCreated }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    group_id: groups[0]?.id || 0,
    title: '',
    description: '',
    proposed_date: '',
    start_time: '',
    end_time: '',
    respond_by: ''
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState([]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  // בדיקת התנגשויות: השבתה אחרת באותו יום שמשפיעה על אותם אנשים
  useEffect(() => {
    if (!form.proposed_date || !form.group_id) { setConflicts([]); return; }
    api.get(`/api/shutdowns/conflicts?date=${form.proposed_date}&group_id=${form.group_id}`)
      .then(d => setConflicts(d.conflicts))
      .catch(() => setConflicts([]));
  }, [form.proposed_date, form.group_id]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.post('/api/shutdowns', { ...form, group_id: Number(form.group_id) });
      onCreated?.();
      navigate(`/shutdowns/${d.shutdown.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="השבתה חדשה" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>קבוצה / רשת</span>
          <select className="select" value={form.group_id} onChange={set('group_id')} required>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>כותרת ההשבתה</span>
          <input className="input" value={form.title} onChange={set('title')} required
            placeholder="לדוגמא: שדרוג מתגי ליבה — רשת X" autoFocus />
        </label>
        <label className="field">
          <span>תיאור והשלכות צפויות</span>
          <textarea className="textarea" value={form.description} onChange={set('description')}
            placeholder="מה מושבת, מי מושפע, מה נדרש מהמשתתפים..." />
        </label>
        <label className="field">
          <span>תאריך מוצע</span>
          <input type="date" className="input" value={form.proposed_date} onChange={set('proposed_date')} required />
        </label>
        {conflicts.length > 0 && (
          <div className="error-msg" style={{ background: 'var(--orange-soft)', color: 'var(--orange)', padding: '8px 12px', borderRadius: 8 }}>
            ⚠️ באותו יום יש כבר השבתה שנוגעת לאותם אנשים:
            {conflicts.map(c => (
              <div key={c.id}>• "{c.title}" ({c.group_name}) — {c.shared_members} חברים משותפים</div>
            ))}
            אפשר להמשיך, אבל שווה לבדוק.
          </div>
        )}
        <label className="field">
          <span>להגיב עד (דד-ליין לאישורים, רשות)</span>
          <input type="date" className="input" value={form.respond_by} onChange={set('respond_by')} max={form.proposed_date || undefined} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>שעת התחלה (רשות)</span>
            <input type="time" className="input" value={form.start_time} onChange={set('start_time')} />
          </label>
          <label className="field">
            <span>שעת סיום (רשות)</span>
            <input type="time" className="input" value={form.end_time} onChange={set('end_time')} />
          </label>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" disabled={busy}>יצירה ושליחת התראות לקבוצה</button>
        </div>
      </form>
    </Modal>
  );
}
