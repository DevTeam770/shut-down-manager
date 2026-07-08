import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

// הודעה לכל המשתמשים (מנהל מערכת). ברירת מחדל: נשלחת גם כמייל לכולם.
export default function AnnounceModal({ onClose }) {
  const [body, setBody] = useState('');
  const [emailAll, setEmailAll] = useState(true);
  const [mailEnabled, setMailEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);

  useEffect(() => {
    api.get('/api/announcements').then(d => setMailEnabled(d.mail_enabled)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/api/announcements', { body: body.trim(), email_all: emailAll });
      setSent(r);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="📣 הודעה לכל המשתמשים" onClose={onClose}>
      {sent ? (
        <>
          <p>ההודעה נשלחה ל-{sent.recipients} משתמשים.</p>
          <p className="muted">
            {sent.mail_sent
              ? '✉️ נשלח גם מייל לכל בעלי כתובת מייל.'
              : emailAll
                ? '✉️ המייל לא נשלח — שרת המייל (SMTP) אינו מוגדר עדיין.'
                : 'המייל לא נשלח (לפי הבחירה).'}
          </p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={onClose}>סגירה</button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <label className="field">
            <span>תוכן ההודעה</span>
            <textarea className="textarea" value={body} onChange={e => setBody(e.target.value)}
              autoFocus maxLength={2000} placeholder="ההודעה תופיע לכל המשתמשים כהתראה קופצת ובפעמון." />
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={emailAll} onChange={e => setEmailAll(e.target.checked)} />
            שליחת מייל לכל המשתמשים
            {!mailEnabled && <span className="muted">(שרת המייל אינו מוגדר — יישלח כשה-SMTP יוגדר)</span>}
          </label>
          {error && <div className="error-msg">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
            <button className="btn btn-primary" disabled={busy || !body.trim()}>שליחה</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
