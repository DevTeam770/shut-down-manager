import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { fmtDateTime } from '../utils/format.js';

const ICONS = {
  pdf: '📕', ppt: '📙', pptx: '📙', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', mp4: '🎬', txt: '📄'
};
const extOf = (name) => name.split('.').pop()?.toLowerCase() || '';
const iconFor = (name) => ICONS[extOf(name)] || '📄';
const isPreviewable = (name) => ['pdf', 'png', 'jpg', 'jpeg', 'gif'].includes(extOf(name));
const fmtSize = (b) => b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`;

// עמוד נהלי השבתות: מצגות ומדריכים. כל המשתמשים צופים; מנהל מערכת מעלה ומוחק.
export default function ProceduresPage() {
  const confirm = useConfirm();
  const [docs, setDocs] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const load = () => api.get('/api/procedures').then(d => { setDocs(d.docs); setCanManage(d.can_manage); }).catch(() => setDocs([]));
  useEffect(() => { load(); }, []);

  const upload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    form.append('title', title.trim());
    try {
      const res = await fetch('/api/procedures', { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'העלאה נכשלה');
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc) => {
    if (!await confirm({ title: 'מחיקת נוהל', body: `למחוק את "${doc.title}"?`, danger: true, confirmLabel: 'מחיקה' })) return;
    try { await api.del(`/api/procedures/${doc.id}`); load(); }
    catch (err) { setError(err.message); }
  };

  if (!docs) return <div className="skeleton" style={{ height: 300 }} />;

  return (
    <>
      <h1>📚 נהלי השבתות</h1>
      <p className="muted">מדריכים ומצגות על שימוש נכון ויעיל במערכת ובתהליך ההשבתה.</p>

      {canManage && (
        <div className="card">
          <h2>העלאת נוהל / מצגת</h2>
          <form className="row" onSubmit={upload}>
            <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="כותרת (רשות)"
              value={title} onChange={e => setTitle(e.target.value)} />
            <input ref={fileRef} type="file" className="input" style={{ flex: 1 }} required />
            <button className="btn btn-primary" disabled={busy}>{busy ? 'מעלה...' : 'העלאה'}</button>
          </form>
          {error && <div className="error-msg">{error}</div>}
        </div>
      )}

      {docs.length === 0 && <div className="card muted">אין נהלים עדיין.</div>}

      <div className="grid-3">
        {docs.map(d => (
          <div key={d.id} className="card">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>{iconFor(d.original_name)} {d.title}</h3>
              {canManage && (
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => remove(d)}>🗑️</button>
              )}
            </div>
            <div className="muted" style={{ margin: '6px 0' }}>
              {fmtSize(d.size)} · {d.uploaded_by} · {fmtDateTime(d.created_at)}
            </div>
            <div className="row">
              {isPreviewable(d.original_name) && (
                <button className="btn btn-ghost btn-sm" onClick={() => setPreview(d)}>👁️ תצוגה</button>
              )}
              <a className="btn btn-ghost btn-sm" href={`/api/procedures/${d.id}`} target="_blank" rel="noreferrer" download>
                ⬇️ הורדה
              </a>
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setPreview(null)}>
          <div className="modal" style={{ width: 'min(900px, 94vw)', height: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div className="row spread" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{preview.title}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>✕</button>
            </div>
            {extOf(preview.original_name) === 'pdf' ? (
              <iframe title={preview.title} src={`/api/procedures/${preview.id}`} style={{ flex: 1, border: 0, borderRadius: 8 }} />
            ) : (
              <img alt={preview.title} src={`/api/procedures/${preview.id}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', margin: 'auto' }} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
