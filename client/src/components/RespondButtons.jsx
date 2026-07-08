import { useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

// שלושת כפתורי התגובה להשבתה:
// ירוק = אישור (עם שדה "משמעות ההשבתה עליי") | אדום = דחייה | כתום = מותנה (תנאי חובה).
// כולם כוללים שדה משמעות אופציונלי שמרוכז למסמך. במצב compact (התראה קופצת/דשבורד)
// אישור הוא בלחיצה אחת מהירה; אפשר להוסיף משמעות אחר כך בדף ההשבתה.
export default function RespondButtons({ shutdownId, onDone, compact = false }) {
  const [modal, setModal] = useState(null); // 'approved' | 'rejected' | 'conditional'
  const [conditionText, setConditionText] = useState('');
  const [impactText, setImpactText] = useState('');
  const [altDate, setAltDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (response, condition_text = '', alternative_date = '', impact_text = '') => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/shutdowns/${shutdownId}/respond`, { response, condition_text, alternative_date, impact_text });
      setModal(null);
      setConditionText('');
      setImpactText('');
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
    setImpactText('');
    setAltDate('');
    setModal(kind);
  };

  const btnCls = compact ? 'btn btn-sm' : 'btn';
  const titles = { approved: 'אישור ההשבתה', rejected: 'דחיית התאריך', conditional: 'אישור מותנה' };

  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <button className={`${btnCls} btn-green`} disabled={busy}
          onClick={() => compact ? send('approved') : openModal('approved')}>
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
        <Modal title={titles[modal]} onClose={() => setModal(null)}>
          {modal !== 'approved' && (
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
          )}
          <label className="field">
            <span>משמעות ההשבתה עליי / על הצוות (רשות — ירוכז למסמך)</span>
            <textarea
              className="textarea"
              autoFocus={modal === 'approved'}
              value={impactText}
              onChange={e => setImpactText(e.target.value)}
              placeholder="לדוגמא: שירות הדוחות לא יהיה זמין ללקוחות בשעות ההשבתה"
            />
          </label>
          {modal !== 'approved' && (
            <label className="field">
              <span>הצעת תאריך חלופי (רשות)</span>
              <input type="date" className="input" value={altDate} onChange={e => setAltDate(e.target.value)} />
            </label>
          )}
          {error && <div className="error-msg">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>ביטול</button>
            <button
              className={`btn ${modal === 'approved' ? 'btn-green' : modal === 'conditional' ? 'btn-orange' : 'btn-red'}`}
              disabled={busy || (modal === 'conditional' && !conditionText.trim())}
              onClick={() => send(modal, conditionText.trim(), altDate, impactText.trim())}
            >
              שליחת תגובה
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
