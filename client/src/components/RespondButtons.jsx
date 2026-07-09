import { useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

// שלושת כפתורי התגובה להשבתה:
// ירוק = אישור | אדום = דחייה | כתום = מותנה (תנאי חובה).
// בכל תגובה חובה למלא שתי משמעויות: ברמת המחלקה + כללית על כלל המערכת —
// אי אפשר לשלוח בלי שתיהן. לכן גם אישור מהיר (compact) פותח את המודאל.
export default function RespondButtons({ shutdownId, onDone, compact = false }) {
  const [modal, setModal] = useState(null); // 'approved' | 'rejected' | 'conditional'
  const [conditionText, setConditionText] = useState('');
  const [impactText, setImpactText] = useState('');       // משמעות ברמת המחלקה
  const [impactGeneral, setImpactGeneral] = useState('');  // משמעות כללית על כולם
  const [altDate, setAltDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setConditionText(''); setImpactText(''); setImpactGeneral(''); setAltDate('');
  };

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/shutdowns/${shutdownId}/respond`, {
        response: modal,
        condition_text: conditionText.trim(),
        alternative_date: altDate,
        impact_text: impactText.trim(),
        impact_general: impactGeneral.trim()
      });
      setModal(null);
      reset();
      onDone?.(modal);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openModal = (kind) => {
    setError('');
    reset();
    setModal(kind);
  };

  const btnCls = compact ? 'btn btn-sm' : 'btn';
  const titles = { approved: 'אישור ההשבתה', rejected: 'דחיית התאריך', conditional: 'אישור מותנה' };
  const canSend = impactText.trim() && impactGeneral.trim() &&
    (modal !== 'conditional' || conditionText.trim());

  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <button className={`${btnCls} btn-green`} disabled={busy} onClick={() => openModal('approved')}>
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
            <span>משמעות ההשבתה ברמת המחלקה שלי <b style={{ color: 'var(--red)' }}>(חובה)</b></span>
            <textarea
              className="textarea"
              autoFocus={modal === 'approved'}
              value={impactText}
              onChange={e => setImpactText(e.target.value)}
              placeholder="לדוגמא: שירות הדוחות לא יהיה זמין ללקוחות הצוות בשעות ההשבתה"
            />
          </label>
          <label className="field">
            <span>משמעות ההשבתה ברמה הכללית — על כלל המערכת/הארגון <b style={{ color: 'var(--red)' }}>(חובה)</b></span>
            <textarea
              className="textarea"
              value={impactGeneral}
              onChange={e => setImpactGeneral(e.target.value)}
              placeholder="לדוגמא: אין השפעה חוצת-ארגון / כל משתמשי המערכת המרכזית ינותקו ל-30 דק'"
            />
          </label>
          {modal !== 'approved' && (
            <label className="field">
              <span>הצעת תאריך חלופי (רשות)</span>
              <input type="date" className="input" value={altDate} onChange={e => setAltDate(e.target.value)} />
            </label>
          )}
          {!canSend && <div className="muted">יש למלא את שתי המשמעויות כדי לשלוח.</div>}
          {error && <div className="error-msg">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>ביטול</button>
            <button
              className={`btn ${modal === 'approved' ? 'btn-green' : modal === 'conditional' ? 'btn-orange' : 'btn-red'}`}
              disabled={busy || !canSend}
              onClick={send}
            >
              שליחת תגובה
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
