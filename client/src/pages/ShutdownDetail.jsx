import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { fmtDate, STATUS_LABELS, STATUS_BADGE, RESPONSE_LABELS } from '../utils/format.js';
import Chat from '../components/Chat.jsx';
import RespondButtons from '../components/RespondButtons.jsx';
import Modal from '../components/Modal.jsx';
import Attachments from '../components/Attachments.jsx';

const RESPONSE_BADGE = { approved: 'badge-green', rejected: 'badge-red', conditional: 'badge-orange' };

export default function ShutdownDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { socket } = useSocket() || {};
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dateModal, setDateModal] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [reviewModal, setReviewModal] = useState(false);
  const [review, setReview] = useState({ summary: '', score: 7, lessons: '' });
  const [version, setVersion] = useState(0); // עולה בכל עדכון חי — מרענן גם את רכיב הקבצים

  const load = useCallback(() => {
    api.get(`/api/shutdowns/${id}`).then(setData).catch(e => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  // עדכון חי כשמשהו משתנה בהשבתה (תגובות, סטטוס, תאריך, קבצים)
  useEffect(() => {
    if (!socket) return;
    const onUpdate = (u) => { if (u.id === Number(id)) { load(); setVersion(v => v + 1); } };
    socket.on('shutdown:updated', onUpdate);
    return () => socket.off('shutdown:updated', onUpdate);
  }, [socket, id, load]);

  if (error) return <div className="card error-msg">{error}</div>;
  if (!data) return <div className="skeleton" style={{ height: 400 }} />;

  const { shutdown: s, is_manager, chat_open } = data;
  const myApproval = s.approvals.find(a => a.user_id === user.id);
  const respondedIds = new Set(s.approvals.map(a => a.user_id));
  const pending = s.members.filter(m => !respondedIds.has(m.id));
  const canRespond = !s.is_final_date && !['completed', 'cancelled'].includes(s.status);

  const patch = async (body) => {
    setError('');
    try {
      await api.patch(`/api/shutdowns/${s.id}`, body);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const adoptDate = async (fromUserId) => {
    setError('');
    try {
      await api.post(`/api/shutdowns/${s.id}/adopt-date`, { from_user_id: fromUserId });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const resolveCondition = async (userId) => {
    setError('');
    try {
      await api.patch(`/api/shutdowns/${s.id}/approvals/${userId}/resolve`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const submitReview = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/shutdowns/${s.id}/review`, { ...review, score: Number(review.score) });
      setReviewModal(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 4 }}>
        <Link to="/shutdowns">השבתות</Link>
        <span className="muted">/</span>
        <h1 style={{ margin: 0 }}>{s.title}</h1>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <span className={`badge ${STATUS_BADGE[s.status]}`}>{STATUS_LABELS[s.status]}</span>
        <span className={`badge ${s.is_final_date ? 'badge-green' : 'badge-orange'}`}>
          {s.is_final_date ? '🟢 תאריך סופי' : '🟠 תאריך מוצע'}: {fmtDate(s.proposed_date)}
          {s.start_time && ` · ${s.start_time}${s.end_time ? `–${s.end_time}` : ''}`}
        </span>
        {s.respond_by && !s.is_final_date && canRespond && (
          <span className={`badge ${s.respond_by < new Date().toISOString().slice(0, 10) ? 'badge-red' : 'badge-blue'}`}>
            ⏳ להגיב עד {fmtDate(s.respond_by)}{s.respond_by < new Date().toISOString().slice(0, 10) ? ' — הדד-ליין עבר!' : ''}
          </span>
        )}
        <span className="muted">קבוצה: <Link to={`/groups/${s.group_id}`}>{s.group_name}</Link> · נפתחה ע"י {s.created_by_name}</span>
        <a className="btn btn-ghost btn-sm" href={`/api/calendar/shutdowns/${s.id}/ics`} download>📅 הוספה ל-Outlook</a>
      </div>

      {s.description && <div className="card" style={{ whiteSpace: 'pre-wrap' }}>{s.description}</div>}

      <div style={{ marginTop: 16 }}>
        <Attachments shutdownId={s.id} refreshKey={version} />
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="grid-2" style={{ marginTop: 16, alignItems: 'start' }}>
        {/* עמודת אישורים ופעולות */}
        <div>
          {canRespond && (
            <div className="card" style={{ borderRight: `4px solid ${myApproval ? 'var(--border)' : 'var(--orange)'}` }}>
              <h2>{myApproval ? 'התגובה שלך (ניתן לעדכן)' : '⏳ נדרשת תגובתך לתאריך'}</h2>
              {myApproval && (
                <p>
                  <span className={`badge ${RESPONSE_BADGE[myApproval.response]}`}>{RESPONSE_LABELS[myApproval.response]}</span>
                  {myApproval.condition_text && <span className="muted"> — {myApproval.condition_text}</span>}
                </p>
              )}
              <RespondButtons shutdownId={s.id} onDone={load} />
            </div>
          )}

          <div className="card">
            <div className="row spread">
              <h2>סטטוס אישורים</h2>
              <span className="muted">{s.approved_count}/{s.members.length} אישרו</span>
            </div>
            <div className="progress" style={{ marginBottom: 12 }}>
              <div style={{ width: `${s.members.length ? 100 * s.approved_count / s.members.length : 0}%` }} />
            </div>
            {s.approvals.map(a => (
              <div key={a.user_id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="row spread">
                  <div className="row">
                    <strong>{a.display_name}</strong>
                    <span className={`badge ${RESPONSE_BADGE[a.response]}`}>{RESPONSE_LABELS[a.response]}</span>
                    {a.response === 'conditional' && !!a.condition_resolved && <span className="badge badge-green">✔ התנאי נפתר</span>}
                  </div>
                  {is_manager && a.response === 'conditional' && !a.condition_resolved && (
                    <button className="btn btn-ghost btn-sm" onClick={() => resolveCondition(a.user_id)}>סימון תנאי כנפתר</button>
                  )}
                </div>
                {a.condition_text && <div className="muted">״{a.condition_text}״</div>}
                {a.alternative_date && (
                  <div className="row" style={{ marginTop: 4 }}>
                    <span className="badge badge-blue">📅 מציע/ה: {fmtDate(a.alternative_date)}</span>
                    {is_manager && canRespond && (
                      <button className="btn btn-ghost btn-sm" onClick={() => adoptDate(a.user_id)}>אימוץ התאריך ← סבב חדש</button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {pending.length > 0 && (
              <p className="muted" style={{ marginTop: 10 }}>
                טרם הגיבו: {pending.map(m => m.display_name).join(', ')}
              </p>
            )}
          </div>

          {/* פעולות מנהל */}
          {is_manager && !['completed', 'cancelled'].includes(s.status) && (
            <div className="card">
              <h2>🛠 פעולות מנהל השבתה</h2>
              <div className="row">
                {!s.is_final_date && (
                  <>
                    <button className="btn btn-green" onClick={() => patch({ is_final_date: true })}>
                      🟢 קיבוע תאריך סופי
                    </button>
                    <button className="btn btn-ghost" onClick={() => { setNewDate(s.proposed_date); setDateModal(true); }}>
                      📅 שינוי תאריך
                    </button>
                  </>
                )}
                {s.status === 'confirmed' && (
                  <button className="btn btn-primary" onClick={() => patch({ status: 'in_progress' })}>▶ תחילת השבתה</button>
                )}
                {s.status === 'in_progress' && (
                  <button className="btn btn-primary" onClick={() => patch({ status: 'completed' })}>🏁 סיום השבתה</button>
                )}
                <button
                  className="btn btn-ghost" style={{ color: 'var(--red)' }}
                  onClick={() => confirm('לבטל את ההשבתה?') && patch({ status: 'cancelled' })}
                >
                  🚫 ביטול השבתה
                </button>
              </div>
            </div>
          )}

          {/* סיכום השבתה */}
          {s.status === 'completed' && (
            <div className="card" style={{ borderRight: '4px solid var(--green)' }}>
              <div className="row spread">
                <h2>📋 סיכום ההשבתה</h2>
                {is_manager && (
                  <button className="btn btn-ghost btn-sm" onClick={() => {
                    if (s.review) setReview({ summary: s.review.summary, score: s.review.score, lessons: s.review.lessons });
                    setReviewModal(true);
                  }}>
                    {s.review ? 'עריכת סיכום' : '+ כתיבת סיכום'}
                  </button>
                )}
              </div>
              {s.review ? (
                <>
                  <div className="row">
                    <span className="badge badge-green" style={{ fontSize: '1rem' }}>ציון: {s.review.score}/10</span>
                  </div>
                  {s.review.summary && <p style={{ whiteSpace: 'pre-wrap' }}>{s.review.summary}</p>}
                  {s.review.lessons && (
                    <>
                      <h3>נקודות לשיפור עתידי</h3>
                      <p style={{ whiteSpace: 'pre-wrap' }} className="muted">{s.review.lessons}</p>
                    </>
                  )}
                </>
              ) : (
                <p className="muted">טרם נכתב סיכום.</p>
              )}
            </div>
          )}
        </div>

        {/* עמודת צ'אט */}
        <Chat shutdownId={s.id} chatOpen={chat_open} />
      </div>

      {dateModal && (
        <Modal title="שינוי תאריך ההשבתה" onClose={() => setDateModal(false)}>
          <p className="muted">שינוי תאריך יאפס את כל התגובות ויפתח סבב אישור חדש.</p>
          <label className="field">
            <span>תאריך חדש</span>
            <input type="date" className="input" value={newDate} onChange={e => setNewDate(e.target.value)} />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setDateModal(false)}>ביטול</button>
            <button className="btn btn-primary" disabled={!newDate} onClick={() => { patch({ proposed_date: newDate }); setDateModal(false); }}>
              עדכון ושליחת התראות
            </button>
          </div>
        </Modal>
      )}

      {reviewModal && (
        <Modal title="סיכום השבתה" onClose={() => setReviewModal(false)}>
          <form onSubmit={submitReview}>
            <label className="field">
              <span>סיכום ההשבתה</span>
              <textarea className="textarea" value={review.summary}
                onChange={e => setReview(r => ({ ...r, summary: e.target.value }))}
                placeholder="מה בוצע, האם עמדנו בלוח הזמנים, תקלות שהתגלו..." />
            </label>
            <label className="field">
              <span>ציון (1–10): {review.score}</span>
              <input type="range" min="1" max="10" value={review.score}
                onChange={e => setReview(r => ({ ...r, score: e.target.value }))} style={{ width: '100%' }} />
            </label>
            <label className="field">
              <span>נקודות לשיפור עתידי</span>
              <textarea className="textarea" value={review.lessons}
                onChange={e => setReview(r => ({ ...r, lessons: e.target.value }))}
                placeholder="מה נעשה אחרת בפעם הבאה..." />
            </label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setReviewModal(false)}>ביטול</button>
              <button className="btn btn-primary">שמירת סיכום</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
