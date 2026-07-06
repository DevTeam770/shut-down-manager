import { useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

// שלושת כפתורי התגובה להשבתה:
// ירוק = אישור מיידי | אדום = דחייה (סיבה + תאריך חלופי אופציונליים) | כתום = מותנה (תנאי חובה + תאריך חלופי)
// משמש גם בדף ההשבתה, גם בדשבורד וגם בתוך התראה קופצת.
export default function RespondButtons({ shutdownId, onDone, compact = false }) {
  const [modal, setModal] = useState(null); // 'rejected' | 'conditional'
  const [conditionText, setConditionText] = useState('');
  const [altDate, setAltDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (response, condition_text = '', alternative_date = '') => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/shutdowns/${shutdownId}/respond`, { response, condition_text, alternative_date });
      setModal(null);
      setConditionText('');
      setAltDate('');
      onDone?.(response);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openModal = (kind) => {
    setError('');
    setConditionText('');
    setAltDate('');
    setModal(kind);
  };

  const btnCls = compact ? 'btn btn-sm' : 'btn';

  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <button className={`${btnCls} btn-green`} disabled={busy} onClick={() => send('approved')}>
          ✓ מאשר/ת
        </button>
        <button className={`${btnCls} btn-red`} disabled={busy} onClick={() => openModal('rejected')}>
          ✗ בלתי אפשרי
        </button>
        <button className={`${btnCls} btn-orange`} disabled={busy} onClick={() => openModal('conditional')}>
          ~ תלוי ב...
        </button>
      </div>
      {error && !modal && <div className="error-msg">{error}</div>}

      {modal && (
        <Modal
          title={modal === 'conditional' ? 'אישור מותנה' : 'דחיית התאריך'}
          onClose={() => setModal(null)}
        >
          <label className="field">
            <span>{modal === 'conditional' ? 'תלוי ב... (חובה)' : 'סיבת הדחייה (רשות)'}</span>
            <textarea
              className="textarea"
              autoFocus
              value={conditionText}
              onChange={e => setConditionText(e.target.value)}
              placeholder={modal === 'conditional' ? 'לדוגמא: תלוי בסיום שדרוג השרתים' : 'מה מונע השבתה בתאריך זה?'}
            />
          </label>
          <label className="field">
            <span>הצעת תאריך חלופי (רשות)</span>
            <input type="date" className="input" value={altDate} onChange={e => setAltDate(e.target.value)} />
          </label>
          {error && <div className="error-msg">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>ביטול</button>
            <button
              className={`btn ${modal === 'conditional' ? 'btn-orange' : 'btn-red'}`}
              disabled={busy || (modal === 'conditional' && !conditionText.trim())}
              onClick={() => send(modal, conditionText.trim(), altDate)}
            >
              שליחת תגובה
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
