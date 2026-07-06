import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password, displayName || username);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="auth-logo">🔌</div>
        <h1 style={{ textAlign: 'center' }}>מערכת ניהול השבתות</h1>
        <p className="muted" style={{ textAlign: 'center', marginTop: -8 }}>
          {mode === 'login' ? 'כניסה עם שם משתמש וסיסמא' : 'הרשמה למערכת'}
        </p>
        <form onSubmit={submit}>
          <label className="field">
            <span>שם משתמש</span>
            <input className="input" value={username} onChange={e => setUsername(e.target.value)}
              autoComplete="username" autoFocus required />
          </label>
          {mode === 'register' && (
            <label className="field">
              <span>שם מלא לתצוגה</span>
              <input className="input" value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>סיסמא</span>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </label>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
            {mode === 'login' ? 'כניסה' : 'הרשמה'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginBottom: 0 }}>
          {mode === 'login' ? (
            <a style={{ cursor: 'pointer' }} onClick={() => { setMode('register'); setError(''); }}>אין לך משתמש? הרשמה</a>
          ) : (
            <a style={{ cursor: 'pointer' }} onClick={() => { setMode('login'); setError(''); }}>יש לך משתמש? כניסה</a>
          )}
        </p>
      </div>
    </div>
  );
}
