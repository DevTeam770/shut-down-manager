import { createContext, useContext, useState, useCallback, useRef } from 'react';

// דיאלוג אישור מרכזי לפעולות הרסניות. שימוש:
//   const confirm = useConfirm();
//   if (await confirm({ title, body, danger: true, confirmLabel: 'מחיקה' })) { ... }
const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((opts) => {
    setState({
      title: opts.title || 'אישור פעולה',
      body: opts.body || '',
      danger: opts.danger !== false, // ברירת מחדל: אזהרה
      confirmLabel: opts.confirmLabel || 'אישור',
      cancelLabel: opts.cancelLabel || 'ביטול'
    });
    return new Promise((resolve) => { resolver.current = resolve; });
  }, []);

  const close = (result) => {
    setState(null);
    resolver.current?.(result);
    resolver.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && close(false)}>
          <div className="modal confirm-modal" role="alertdialog" aria-label={state.title}>
            <div className={`confirm-head ${state.danger ? 'danger' : ''}`}>
              <span className="confirm-icon">{state.danger ? '⚠️' : '❓'}</span>
              <h2>{state.title}</h2>
            </div>
            {state.body && <p className="confirm-body">{state.body}</p>}
            {state.danger && <p className="confirm-warning">פעולה זו אינה הפיכה.</p>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => close(false)} autoFocus>{state.cancelLabel}</button>
              <button className={`btn ${state.danger ? 'btn-red' : 'btn-primary'}`} onClick={() => close(true)}>
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
