import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { fmtDateTime } from '../utils/format.js';

const ICONS = {
  pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️',
  zip: '🗜️', rar: '🗜️', '7z': '🗜️', txt: '📄', csv: '📊', vsd: '📐', vsdx: '📐'
};
const iconFor = (name) => ICONS[name.split('.').pop()?.toLowerCase()] || '📄';

const fmtSize = (b) =>
  b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`;

// קבצים מצורפים להשבתה: העלאה למנהל השבתה/admin, הורדה לכל חברי הקבוצה.
// מתרענן דרך shutdown:updated (ההורה קורא ל-load מחדש עם refreshKey).
export default function Attachments({ shutdownId, refreshKey }) {
  const confirm = useConfirm();
  const [files, setFiles] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const load = useCallback(() => {
    api.get(`/api/shutdowns/${shutdownId}/files`)
      .then(d => { setFiles(d.files); setCanManage(d.can_manage); })
      .catch(() => {});
  }, [shutdownId]);

  useEffect(load, [load, refreshKey]);

  const uploadFiles = async (fileList) => {
    if (!fileList?.length) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    for (const f of [...fileList].slice(0, 5)) form.append('files', f);
    try {
      const res = await fetch(`/api/shutdowns/${shutdownId}/files`, {
        method: 'POST',
        body: form,
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'העלאה נכשלה');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeFile = async (f) => {
    if (!await confirm({ title: 'מחיקת קובץ', body: `למחוק את "${f.original_name}"?`, danger: true, confirmLabel: 'מחיקה' })) return;
    try {
      await api.del(`/api/shutdowns/${shutdownId}/files/${f.id}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!canManage && files.length === 0) return null; // אין מה להציג למשתמש רגיל בלי קבצים

  return (
    <div
      className="card"
      style={dragging ? { outline: '2px dashed var(--primary)', outlineOffset: -6 } : undefined}
      onDragOver={canManage ? (e) => { e.preventDefault(); setDragging(true); } : undefined}
      onDragLeave={canManage ? () => setDragging(false) : undefined}
      onDrop={canManage ? (e) => { e.preventDefault(); setDragging(false); uploadFiles(e.dataTransfer.files); } : undefined}
    >
      <div className="row spread">
        <h2>📎 קבצים מצורפים {files.length > 0 && <span className="muted">({files.length})</span>}</h2>
        {canManage && (
          <>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? 'מעלה...' : '+ העלאת קבצים'}
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={e => uploadFiles(e.target.files)}
            />
          </>
        )}
      </div>

      {files.length === 0 && (
        <p className="muted">אין קבצים עדיין{canManage ? ' — אפשר גם לגרור קבצים לכאן' : ''}.</p>
      )}

      {files.map(f => (
        <div key={f.id} className="row spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
          <a href={`/api/shutdowns/${shutdownId}/files/${f.id}`} download style={{ fontWeight: 600 }}>
            {iconFor(f.original_name)} {f.original_name}
          </a>
          <div className="row" style={{ gap: 8 }}>
            <span className="muted">{fmtSize(f.size)} · {f.uploaded_by} · {fmtDateTime(f.created_at)}</span>
            {canManage && (
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} title="מחיקה"
                onClick={() => removeFile(f)}>🗑️</button>
            )}
          </div>
        </div>
      ))}

      {error && <div className="error-msg">{error}</div>}
    </div>
  );
}
