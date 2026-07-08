import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// משוב מכל המשתתפים אחרי סיום השבתה: כל חבר קבוצה נותן ציון + הערה (ניתן לעדכן).
export default function FeedbackCard({ shutdownId, feedback, avgFeedback, onChange }) {
  const { user } = useAuth();
  const mine = feedback.find(f => f.user_id === user.id);
  const [score, setScore] = useState(mine?.score ?? 7);
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [editing, setEditing] = useState(!mine);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/api/shutdowns/${shutdownId}/feedback`, { score: Number(score), comment: comment.trim() });
      setEditing(false);
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="card">
      <div className="row spread">
        <h2>🗳️ משוב המשתתפים</h2>
        {avgFeedback != null && (
          <span className="badge badge-blue" style={{ fontSize: '.95rem' }}>
            ממוצע: {avgFeedback}/10 ({feedback.length} משיבים)
          </span>
        )}
      </div>

      {editing ? (
        <form onSubmit={submit}>
          <label className="field">
            <span>איך הייתה ההשבתה מבחינתך? ציון: {score}</span>
            <input type="range" min="1" max="10" value={score} onChange={e => setScore(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label className="field">
            <span>הערה (רשות)</span>
            <textarea className="textarea" value={comment} onChange={e => setComment(e.target.value)}
              placeholder="מה עבד טוב, מה פחות..." maxLength={1000} />
          </label>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary btn-sm">{mine ? 'עדכון המשוב' : 'שליחת משוב'}</button>
        </form>
      ) : (
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="badge badge-green">המשוב שלך: {mine.score}/10</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>עריכה</button>
        </div>
      )}

      {feedback.filter(f => f.comment).length > 0 && (
        <div style={{ marginTop: 10 }}>
          {feedback.filter(f => f.comment).map(f => (
            <div key={f.user_id} style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <strong>{f.display_name}</strong> <span className="badge badge-gray">{f.score}/10</span>
              <div className="muted">{f.comment}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
