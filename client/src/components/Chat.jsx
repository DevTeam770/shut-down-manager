import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { useSocket } from '../context/SocketContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { fmtTime } from '../utils/format.js';

// חדר הצ'אט של השבתה:
// - היסטוריה נטענת ב-REST (50 אחרונות + "טען עוד" לגלילה אחורה)
// - הודעות חדשות ב-Socket.IO
// - סנכרון אחרי ניתוק: ב-reconnect מושכים כל מה שאחרי ההודעה האחרונה שראינו
// - הקלדה, נוכחות, קיבוץ הודעות רצופות, חיווי נמסר
export default function Chat({ shutdownId, chatOpen, members = [], isManager = false }) {
  const { socket, connected } = useSocket() || {};
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [presence, setPresence] = useState([]);
  const [typing, setTyping] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = מצב חי
  const [mentionOpen, setMentionOpen] = useState(false);
  const [recipient, setRecipient] = useState(''); // '' = לכולם; אחרת id נמען (הודעה פרטית, למנהל)
  const listRef = useRef(null);
  const lastIdRef = useRef(0);
  const typingTimer = useRef(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const appendMessages = useCallback((newMsgs) => {
    if (!newMsgs.length) return;
    setMessages(prev => {
      const ids = new Set(prev.map(m => m.id));
      const merged = [...prev, ...newMsgs.filter(m => !ids.has(m.id))];
      merged.sort((a, b) => a.id - b.id);
      return merged;
    });
    lastIdRef.current = Math.max(lastIdRef.current, ...newMsgs.map(m => m.id));
  }, []);

  // טעינת היסטוריה ראשונית
  useEffect(() => {
    let alive = true;
    api.get(`/api/shutdowns/${shutdownId}/messages`).then(d => {
      if (!alive) return;
      setMessages(d.messages);
      setHasMore(d.messages.length >= 50);
      if (d.messages.length) lastIdRef.current = d.messages[d.messages.length - 1].id;
      setTimeout(scrollToBottom, 30);
    }).catch(e => setError(e.message));
    return () => { alive = false; };
  }, [shutdownId]);

  // הצטרפות לחדר + האזנות
  useEffect(() => {
    if (!socket) return;
    const join = () => {
      socket.emit('chat:join', shutdownId, (res) => {
        if (res?.error) setError(res.error);
      });
      // סנכרון הודעות שפוספסו בזמן ניתוק
      if (lastIdRef.current > 0) {
        api.get(`/api/shutdowns/${shutdownId}/messages?after_id=${lastIdRef.current}`)
          .then(d => appendMessages(d.messages))
          .catch(() => {});
      }
    };
    join();
    socket.on('connect', join); // reconnect ⇦ הצטרפות מחדש + סנכרון

    const onMessage = (m) => {
      if (m.shutdown_id !== Number(shutdownId)) return;
      appendMessages([m]);
      setTyping(null);
    };
    const onPresence = (users) => setPresence(users);
    const onTyping = ({ display_name }) => {
      setTyping(display_name);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(null), 2500);
    };
    socket.on('chat:message', onMessage);
    socket.on('chat:presence', onPresence);
    socket.on('chat:typing', onTyping);

    return () => {
      socket.emit('chat:leave', shutdownId);
      socket.off('connect', join);
      socket.off('chat:message', onMessage);
      socket.off('chat:presence', onPresence);
      socket.off('chat:typing', onTyping);
    };
  }, [socket, shutdownId, appendMessages]);

  // גלילה אוטומטית רק אם המשתמש בתחתית
  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const loadOlder = async () => {
    const oldest = messages[0];
    if (!oldest) return;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight || 0;
    const d = await api.get(`/api/shutdowns/${shutdownId}/messages?before_id=${oldest.id}`);
    setMessages(prev => {
      const ids = new Set(prev.map(m => m.id));
      return [...d.messages.filter(m => !ids.has(m.id)), ...prev];
    });
    setHasMore(d.messages.length >= 50);
    // שמירת מיקום הגלילה
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
    });
  };

  const send = (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !socket) return;
    setText('');
    setMentionOpen(false);
    socket.emit('chat:send', {
      shutdownId: Number(shutdownId),
      body,
      recipientId: recipient ? Number(recipient) : null
    }, (res) => {
      if (res?.error) setError(res.error);
    });
  };

  const onType = (e) => {
    const val = e.target.value;
    setText(val);
    socket?.emit('chat:typing', Number(shutdownId));
    // פתיחת בורר אזכורים כשמקלידים @ בסוף המילה הנוכחית
    const caret = e.target.selectionStart;
    const before = val.slice(0, caret);
    setMentionOpen(/@[^\s@]*$/.test(before) && members.length > 0);
  };

  const insertMention = (name) => {
    setText(t => t.replace(/@[^\s@]*$/, `@${name} `));
    setMentionOpen(false);
    inputRef.current?.focus();
  };

  // חיפוש בהיסטוריית הצ'אט (debounce קצר); ריקון מחזיר לשידור חי
  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const t = setTimeout(() => {
      api.get(`/api/shutdowns/${shutdownId}/messages?q=${encodeURIComponent(search.trim())}`)
        .then(d => setSearchResults(d.messages))
        .catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [search, shutdownId]);

  // הדגשת אזכורים בגוף ההודעה
  const renderBody = (body) => {
    const parts = body.split(/(@[^\s@]+(?:\s[^\s@]+)?)/g);
    return parts.map((p, i) => {
      if (p.startsWith('@') && members.some(m => `@${m.display_name}` === p.trim())) {
        return <strong key={i} className="mention">{p}</strong>;
      }
      return p;
    });
  };

  // קיבוץ הודעות רצופות מאותו כותב (בטווח 3 דקות)
  const grouped = messages.map((m, i) => {
    const prev = messages[i - 1];
    const sameAuthor = prev && prev.user_id === m.user_id && prev.type === 'text' && m.type === 'text';
    const closeTime = prev && (new Date(m.created_at.replace(' ', 'T') + 'Z') - new Date(prev.created_at.replace(' ', 'T') + 'Z')) < 3 * 60 * 1000;
    return { ...m, showHeader: !(sameAuthor && closeTime) };
  });

  return (
    <div className="chat">
      <div className="chat-header">
        <strong>💬 חדר דיון</strong>
        <span className="presence" style={{ flex: 1 }}>
          {presence.length > 0 && `מחוברים: ${presence.map(p => p.display_name).join(', ')}`}
        </span>
        <input
          className="input"
          style={{ width: 150, padding: '4px 10px', fontSize: '.84rem' }}
          placeholder="🔍 חיפוש בצ'אט"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {!connected && <span className="badge badge-orange">מנותק</span>}
      </div>

      {searchResults !== null ? (
        <div className="chat-messages">
          <div className="row spread" style={{ marginBottom: 6 }}>
            <span className="muted">{searchResults.length} תוצאות עבור "{search}"</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>✕ חזרה לשיחה</button>
          </div>
          {searchResults.map(m => (
            <div className="msg theirs" key={m.id} style={{ maxWidth: '100%' }}>
              <div className="meta"><strong>{m.display_name} · </strong>{fmtTime(m.created_at)}</div>
              <div className="bubble">{m.body}</div>
            </div>
          ))}
          {searchResults.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>אין תוצאות</p>}
        </div>
      ) : (
      <div className="chat-messages" ref={listRef} onScroll={onScroll}>
        {hasMore && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center', marginBottom: 8 }} onClick={loadOlder}>
            ↑ טעינת הודעות קודמות
          </button>
        )}
        {grouped.map(m => (
          m.type === 'system' ? (
            <div className="msg system" key={m.id}>
              <div className="bubble">{m.body}</div>
            </div>
          ) : (
            <div className={`msg ${m.user_id === user.id ? 'mine' : 'theirs'}`} key={m.id}>
              {m.showHeader && (
                <div className="meta">
                  {m.user_id !== user.id && <strong>{m.display_name} · </strong>}
                  {m.role === 'admin' && <span className="badge badge-blue" style={{ padding: '0 6px', fontSize: '.68rem' }}>הנהלה</span>}
                  {' '}{fmtTime(m.created_at)}
                </div>
              )}
              <div className={`bubble ${m.recipient_id ? 'private' : ''}`}>
                {m.recipient_id && <span title="הודעה פרטית">🔒 </span>}
                {renderBody(m.body)}
              </div>
            </div>
          )
        ))}
        {messages.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>עדיין אין הודעות — פתחו את הדיון 🙂</p>}
      </div>
      )}

      <div className="typing">{typing ? `${typing} מקליד/ה...` : ''}</div>

      {chatOpen && isManager && (
        <div className="chat-recipient">
          <span className="muted">שליחה אל:</span>
          <select className="select" value={recipient} onChange={e => setRecipient(e.target.value)}>
            <option value="">📢 כולם (הודעת מנהלה + מייל)</option>
            {members.filter(m => m.id !== user.id).map(m => (
              <option key={m.id} value={m.id}>🔒 פרטי: {m.display_name}</option>
            ))}
          </select>
        </div>
      )}

      {chatOpen ? (
        <form className="chat-input" onSubmit={send} style={{ position: 'relative' }}>
          {mentionOpen && (
            <div className="mention-picker">
              {members
                .filter(m => {
                  const frag = (text.match(/@([^\s@]*)$/) || [])[1] || '';
                  return m.id !== user.id && m.display_name.startsWith(frag);
                })
                .slice(0, 6)
                .map(m => (
                  <div key={m.id} className="mention-option" onMouseDown={e => { e.preventDefault(); insertMention(m.display_name); }}>
                    @{m.display_name}
                  </div>
                ))}
            </div>
          )}
          <input
            ref={inputRef}
            className="input"
            value={text}
            onChange={onType}
            onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
            placeholder={recipient ? '🔒 הודעה פרטית...' : 'כתיבת הודעה... (@ לאזכור)'}
            maxLength={2000}
          />
          <button className="btn btn-primary" disabled={!text.trim() || !connected}>שליחה</button>
        </form>
      ) : (
        <div className="chat-closed">🔒 ההשבתה הסתיימה — הצ'אט סגור לכתיבה (ההיסטוריה נשמרת)</div>
      )}
      {error && <div className="error-msg" style={{ padding: '0 12px 8px' }}>{error}</div>}
    </div>
  );
}
