import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HDate, HebrewCalendar, Locale } from '@hebcal/core';
import { api } from '../api/client.js';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// לוח שנה חודשי משולב עברי-לועזי.
// כתום = תאריך השבתה מוצע, ירוק = תאריך סופי. חגים מסומנים בכחול.
export default function CalendarPage() {
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [events, setEvents] = useState([]);

  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => {
    api.get(`/api/calendar?month=${monthKey}`).then(d => setEvents(d.events)).catch(() => setEvents([]));
  }, [monthKey]);

  // חגי ישראל לחודש המוצג (@hebcal — חישוב מקומי, ללא רשת)
  const holidays = useMemo(() => {
    try {
      const evs = HebrewCalendar.calendar({
        year: cursor.getFullYear(),
        month: cursor.getMonth() + 1,
        isHebrewYear: false,
        il: true,
        noMinorFast: true,
        noRoshChodesh: true
      });
      const map = {};
      for (const ev of evs) {
        const key = ymd(ev.getDate().greg());
        map[key] = ev.render('he');
      }
      return map;
    } catch {
      return {};
    }
  }, [monthKey]);

  // בניית תאי הלוח: מיום ראשון של השבוע שבו מתחיל החודש
  const cells = useMemo(() => {
    const first = new Date(cursor);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
    }
    // אם השורה האחרונה כולה מחוץ לחודש — מקצרים ל-35 תאים
    return out[35].getMonth() !== cursor.getMonth() ? out.slice(0, 35) : out;
  }, [cursor]);

  const eventsByDate = useMemo(() => {
    const map = {};
    for (const e of events) (map[e.proposed_date] ||= []).push(e);
    return map;
  }, [events]);

  const todayKey = ymd(new Date());
  const hebMonthLabel = useMemo(() => {
    const a = new HDate(cells[7]);
    const b = new HDate(cells[cells.length - 8]);
    const ma = Locale.gettext(a.getMonthName(), 'he');
    const mb = Locale.gettext(b.getMonthName(), 'he');
    return ma === mb ? `${ma} ${a.getFullYear()}` : `${ma}–${mb} ${b.getFullYear()}`;
  }, [cells]);

  return (
    <>
      <div className="row spread" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>
          {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
          <span className="muted" style={{ fontSize: '.95rem', marginRight: 10 }}>{hebMonthLabel}</span>
        </h1>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>‹ הבא</button>
          <button className="btn btn-ghost" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>היום</button>
          <button className="btn btn-ghost" onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>הקודם ›</button>
          <a className="btn btn-ghost" href="/api/calendar/my.ics" download title="הורדת כל ההשבתות שלי לקובץ ליומן Outlook">
            📅 ייצוא ל-Outlook
          </a>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <span className="badge badge-orange">🟠 תאריך מוצע</span>
        <span className="badge badge-green">🟢 תאריך סופי</span>
      </div>

      <div className="calendar-grid">
        {DAY_NAMES.map(d => <div className="cal-head" key={d}>{d}</div>)}
        {cells.map(d => {
          const key = ymd(d);
          const hd = new HDate(d);
          const dayEvents = eventsByDate[key] || [];
          return (
            <div
              key={key}
              className={`cal-cell ${d.getMonth() !== cursor.getMonth() ? 'other' : ''} ${key === todayKey ? 'today' : ''}`}
            >
              <div className="cal-date">
                <span className="greg">{d.getDate()}</span>
                <span className="heb">{Locale.hebrewStripNikkud(hd.renderGematriya(true)).split(' ')[0]} {Locale.gettext(hd.getMonthName(), 'he')}</span>
              </div>
              {holidays[key] && <div className="cal-holiday">✡ {holidays[key]}</div>}
              {dayEvents.map(e => (
                <div
                  key={e.id}
                  className={`cal-event ${e.is_final_date ? 'final' : 'proposed'}`}
                  title={`${e.title} (${e.group_name})${e.start_time ? ` ${e.start_time}` : ''}`}
                  onClick={() => navigate(`/shutdowns/${e.id}`)}
                >
                  {e.start_time && `${e.start_time} `}{e.title}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
