// עזרי תצוגה משותפים
export const STATUS_LABELS = {
  proposed: 'מוצעת',
  confirmed: 'מאושרת',
  in_progress: 'בביצוע',
  completed: 'הסתיימה',
  cancelled: 'בוטלה'
};

export const STATUS_BADGE = {
  proposed: 'badge-orange',
  confirmed: 'badge-green',
  in_progress: 'badge-blue',
  completed: 'badge-gray',
  cancelled: 'badge-red'
};

export const RESPONSE_LABELS = {
  approved: 'אישר/ה',
  rejected: 'דחה/תה',
  conditional: 'מותנה'
};

export function fmtDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateTime(sqlite) {
  if (!sqlite) return '';
  // SQLite datetime('now') הוא UTC — המרה לזמן מקומי
  const d = new Date(sqlite.replace(' ', 'T') + 'Z');
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(sqlite) {
  if (!sqlite) return '';
  const d = new Date(sqlite.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}
