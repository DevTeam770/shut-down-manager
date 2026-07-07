// בדיקות אינטגרציה לליבה העסקית: auth, הרשאות, קבוצות, השבתות, תגובות, מעברי סטטוס
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// DB זמני נקי לכל ריצה + פורט אקראי
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.PORT = '0';
process.env.ENV_FILE = path.join(tmpDir, '.env');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');

const { app } = await import('../src/index.js');

// סוכנים עם cookies נפרדים לכל משתמש
const admin = request.agent(app);
const manager = request.agent(app);
const member = request.agent(app);
const outsider = request.agent(app);

let groupId, shutdownId;
let managerId, memberId;

beforeAll(async () => {
  // admin נוצר אוטומטית ב-seed
  await admin.post('/api/auth/login').send({ username: 'admin', password: 'admin123' }).expect(200);

  const m1 = await manager.post('/api/auth/register')
    .send({ username: 'moshe', password: 'pass123', display_name: 'משה המנהל' }).expect(201);
  managerId = m1.body.user.id;

  const m2 = await member.post('/api/auth/register')
    .send({ username: 'dana', password: 'pass123', display_name: 'דנה' }).expect(201);
  memberId = m2.body.user.id;

  await outsider.post('/api/auth/register')
    .send({ username: 'zar', password: 'pass123', display_name: 'משתמש זר' }).expect(201);
});

describe('אימות והרשאות', () => {
  it('דוחה גישה ללא התחברות', async () => {
    await request(app).get('/api/shutdowns').expect(401);
  });

  it('דוחה סיסמא שגויה', async () => {
    await request(app).post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong1' }).expect(401);
  });

  it('משתמש רגיל לא יכול ליצור משתמשים', async () => {
    await member.post('/api/users')
      .send({ username: 'x1', password: 'pass123', display_name: 'איקס' }).expect(403);
  });

  it('משתמש רגיל לא יכול ליצור קבוצה', async () => {
    await member.post('/api/groups').send({ name: 'קבוצה אסורה' }).expect(403);
  });
});

describe('קבוצות', () => {
  it('admin יוצר קבוצה והופך את משה למנהל השבתה', async () => {
    const g = await admin.post('/api/groups')
      .send({ name: 'רשת ליבה', description: 'מתגי ליבה ראשיים' }).expect(201);
    groupId = g.body.group.id;

    await admin.post(`/api/groups/${groupId}/members`)
      .send({ user_id: managerId, is_shutdown_manager: true }).expect(201);
    await admin.post(`/api/groups/${groupId}/members`)
      .send({ user_id: memberId, is_shutdown_manager: false }).expect(201);
  });

  it('מונע כפילות שם קבוצה', async () => {
    await admin.post('/api/groups').send({ name: 'רשת ליבה' }).expect(409);
  });

  it('חיפוש קבוצה עובד', async () => {
    const r = await manager.get('/api/groups?q=ליבה').expect(200);
    expect(r.body.groups.length).toBe(1);
  });
});

describe('השבתות: יצירה ותגובות', () => {
  it('מנהל השבתה יוצר השבתה', async () => {
    const r = await manager.post('/api/shutdowns').send({
      group_id: groupId,
      title: 'שדרוג מתגי ליבה',
      description: 'החלפת קושחה',
      proposed_date: '2026-08-15',
      start_time: '22:00',
      end_time: '02:00'
    }).expect(201);
    shutdownId = r.body.shutdown.id;
    expect(r.body.shutdown.status).toBe('proposed');
  });

  it('חבר רגיל לא יכול ליצור השבתה', async () => {
    await member.post('/api/shutdowns').send({
      group_id: groupId, title: 'ניסיון אסור', proposed_date: '2026-08-20'
    }).expect(403);
  });

  it('משתמש זר לא רואה את ההשבתה', async () => {
    await outsider.get(`/api/shutdowns/${shutdownId}`).expect(403);
  });

  it('תגובה מותנית ללא טקסט נדחית', async () => {
    await member.post(`/api/shutdowns/${shutdownId}/respond`)
      .send({ response: 'conditional' }).expect(400);
  });

  it('תגובה מותנית עם תנאי ותאריך חלופי מתקבלת', async () => {
    const r = await member.post(`/api/shutdowns/${shutdownId}/respond`)
      .send({ response: 'conditional', condition_text: 'תלוי בסיום גיבוי', alternative_date: '2026-08-22' })
      .expect(200);
    const a = r.body.shutdown.approvals.find(x => x.user_id === memberId);
    expect(a.alternative_date).toBe('2026-08-22');
  });

  it('מנהל מסמן תנאי כנפתר', async () => {
    const r = await manager.patch(`/api/shutdowns/${shutdownId}/approvals/${memberId}/resolve`).expect(200);
    const a = r.body.shutdown.approvals.find(x => x.user_id === memberId);
    expect(a.condition_resolved).toBe(1);
  });

  it('חבר רגיל לא יכול לאמץ תאריך חלופי', async () => {
    await member.post(`/api/shutdowns/${shutdownId}/adopt-date`)
      .send({ from_user_id: memberId }).expect(403);
  });

  it('מנהל מאמץ תאריך חלופי — סבב אישורים מתאפס', async () => {
    const r = await manager.post(`/api/shutdowns/${shutdownId}/adopt-date`)
      .send({ from_user_id: memberId }).expect(200);
    expect(r.body.shutdown.proposed_date).toBe('2026-08-22');
    expect(r.body.shutdown.approvals.length).toBe(0);
    expect(r.body.shutdown.is_final_date).toBe(0);
  });
});

describe('קיבוע תאריך ומעברי סטטוס', () => {
  it('כולם מאשרים ומקבעים תאריך סופי', async () => {
    await member.post(`/api/shutdowns/${shutdownId}/respond`).send({ response: 'approved' }).expect(200);
    await manager.post(`/api/shutdowns/${shutdownId}/respond`).send({ response: 'approved' }).expect(200);
    const r = await manager.patch(`/api/shutdowns/${shutdownId}`).send({ is_final_date: true }).expect(200);
    expect(r.body.shutdown.is_final_date).toBe(1);
    expect(r.body.shutdown.status).toBe('confirmed');
  });

  it('אחרי קיבוע — אי אפשר להגיב יותר', async () => {
    await member.post(`/api/shutdowns/${shutdownId}/respond`).send({ response: 'rejected' }).expect(400);
  });

  it('מעבר סטטוס לא חוקי נדחה (confirmed -> completed)', async () => {
    await manager.patch(`/api/shutdowns/${shutdownId}`).send({ status: 'completed' }).expect(400);
  });

  it('חבר רגיל לא יכול לשנות סטטוס', async () => {
    await member.patch(`/api/shutdowns/${shutdownId}`).send({ status: 'in_progress' }).expect(403);
  });

  it('סיכום לפני סיום נדחה', async () => {
    await manager.post(`/api/shutdowns/${shutdownId}/review`)
      .send({ score: 8 }).expect(400);
  });

  it('מעבר מלא: ביצוע -> סיום -> סיכום', async () => {
    await manager.patch(`/api/shutdowns/${shutdownId}`).send({ status: 'in_progress' }).expect(200);
    await manager.patch(`/api/shutdowns/${shutdownId}`).send({ status: 'completed' }).expect(200);
    const r = await manager.post(`/api/shutdowns/${shutdownId}/review`)
      .send({ summary: 'עבר חלק', score: 9, lessons: 'לתאם מראש עם ספק' }).expect(200);
    expect(r.body.shutdown.review.score).toBe(9);
  });
});

describe('שדרוגים: דד-ליין, התנגשויות, active-now, revocation, audit, סקדולר', () => {
  let sid2;

  it('יצירת השבתה עם דד-ליין לתגובה', async () => {
    const r = await manager.post('/api/shutdowns').send({
      group_id: groupId, title: 'השבתה עם דד-ליין', proposed_date: '2027-01-20', respond_by: '2027-01-15'
    }).expect(201);
    sid2 = r.body.shutdown.id;
    expect(r.body.shutdown.respond_by).toBe('2027-01-15');
  });

  it('זיהוי התנגשות: השבתה אחרת באותו יום עם חברים משותפים', async () => {
    const r = await manager.get(`/api/shutdowns/conflicts?date=2027-01-20&group_id=${groupId}`).expect(200);
    expect(r.body.conflicts.length).toBe(1);
    expect(r.body.conflicts[0].shared_members).toBeGreaterThan(0);
    // יום פנוי — אין התנגשויות
    const clean = await manager.get(`/api/shutdowns/conflicts?date=2027-06-06&group_id=${groupId}`).expect(200);
    expect(clean.body.conflicts.length).toBe(0);
  });

  it('active-now מציג השבתה בביצוע לחבר קבוצה בלבד', async () => {
    // מקבעים ומריצים את ההשבתה
    await member.post(`/api/shutdowns/${sid2}/respond`).send({ response: 'approved' });
    await manager.post(`/api/shutdowns/${sid2}/respond`).send({ response: 'approved' });
    await manager.patch(`/api/shutdowns/${sid2}`).send({ is_final_date: true }).expect(200);
    await manager.patch(`/api/shutdowns/${sid2}`).send({ status: 'in_progress' }).expect(200);

    const mine = await member.get('/api/shutdowns/active-now').expect(200);
    expect(mine.body.active.some(a => a.id === sid2)).toBe(true);
    const foreign = await outsider.get('/api/shutdowns/active-now').expect(200);
    expect(foreign.body.active.some(a => a.id === sid2)).toBe(false);
    await manager.patch(`/api/shutdowns/${sid2}`).send({ status: 'completed' }).expect(200);
  });

  it('תזכורת נשלחת רק למי שטרם הגיב, ופעם אחת ביום', async () => {
    const { runReminders } = await import('../src/services/scheduler.js');
    const db = (await import('../src/db/db.js')).default;
    // השבתה עתידית בלי תגובה של dana (memberId)
    const r = await manager.post('/api/shutdowns').send({
      group_id: groupId, title: 'השבתה לתזכורת', proposed_date: '2027-03-03'
    }).expect(201);
    db.prepare(`DELETE FROM notifications WHERE kind = 'reminder'`).run();

    runReminders();
    const first = db.prepare(
      `SELECT COUNT(*) AS c FROM notifications WHERE kind = 'reminder' AND user_id = ? AND shutdown_id = ?`
    ).get(memberId, r.body.shutdown.id).c;
    expect(first).toBe(1);

    runReminders(); // ריצה שנייה באותו יום — לא שולחת שוב
    const second = db.prepare(
      `SELECT COUNT(*) AS c FROM notifications WHERE kind = 'reminder' AND user_id = ? AND shutdown_id = ?`
    ).get(memberId, r.body.shutdown.id).c;
    expect(second).toBe(1);
  });

  it('מעבר אוטומטי ל"בביצוע" כשמגיעה שעת ההתחלה', async () => {
    const { runAutoTransitions } = await import('../src/services/scheduler.js');
    const db = (await import('../src/db/db.js')).default;
    const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD מקומי
    const r = await manager.post('/api/shutdowns').send({
      group_id: groupId, title: 'השבתה אוטומטית', proposed_date: today, start_time: '00:00', end_time: '23:59'
    }).expect(201);
    db.prepare(`UPDATE shutdowns SET status = 'confirmed', is_final_date = 1 WHERE id = ?`).run(r.body.shutdown.id);

    runAutoTransitions();
    const after = db.prepare('SELECT status FROM shutdowns WHERE id = ?').get(r.body.shutdown.id);
    expect(after.status).toBe('in_progress');
    db.prepare(`UPDATE shutdowns SET status = 'completed' WHERE id = ?`).run(r.body.shutdown.id);
  });

  it('איפוס סיסמא ע"י admin מנתק מיידית התחברות קיימת (revocation)', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register')
      .send({ username: 'revoked1', password: 'pass123', display_name: 'מנותק' }).expect(201);
    await agent.get('/api/auth/me').expect(200); // מחובר

    const users = await admin.get('/api/users?q=revoked1').expect(200);
    await admin.patch(`/api/users/${users.body.users[0].id}`).send({ password: 'newpass1' }).expect(200);

    await agent.get('/api/auth/me').expect(401); // ה-cookie הישן כבר לא תקף
  });

  it('ייצוא CSV מחזיר דוח עם BOM וכל ההשבתות בהיקף המשתמש', async () => {
    const r = await member.get('/api/stats/export.csv').expect(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.text.charCodeAt(0)).toBe(0xFEFF); // BOM לזיהוי עברית ב-Excel
    expect(r.text).toContain('שדרוג מתגי ליבה');
    expect(r.text).toContain('ציון');
    // משתמש זר בלי קבוצות — מקבל רק כותרת
    const empty = await outsider.get('/api/stats/export.csv').expect(200);
    expect(empty.text.trim().split('\n').length).toBe(1);
  });

  it('יומן פעולות נגיש ל-admin בלבד ומכיל רשומות', async () => {
    await member.get('/api/audit').expect(403);
    const r = await admin.get('/api/audit').expect(200);
    expect(r.body.entries.length).toBeGreaterThan(5);
    expect(r.body.entries.some(e => e.action === 'create_shutdown')).toBe(true);
  });
});

describe('קבצים מצורפים', () => {
  let fileId;
  const pdfContent = Buffer.from('%PDF-1.4 fake test file תוכן בעברית');

  it('חבר רגיל לא יכול להעלות קובץ', async () => {
    await member.post(`/api/shutdowns/${shutdownId}/files`)
      .attach('files', pdfContent, 'נוהל-השבתה.pdf').expect(403);
  });

  it('משתמש זר לא יכול להעלות קובץ', async () => {
    await outsider.post(`/api/shutdowns/${shutdownId}/files`)
      .attach('files', pdfContent, 'x.pdf').expect(403);
  });

  it('קובץ הרצה (exe) נחסם', async () => {
    await manager.post(`/api/shutdowns/${shutdownId}/files`)
      .attach('files', Buffer.from('MZ'), 'virus.exe').expect(400);
  });

  it('מנהל השבתה מעלה קובץ בהצלחה', async () => {
    const r = await manager.post(`/api/shutdowns/${shutdownId}/files`)
      .attach('files', pdfContent, 'נוהל-השבתה.pdf').expect(201);
    expect(r.body.count).toBe(1);
  });

  it('admin מעלה קובץ בהצלחה', async () => {
    await admin.post(`/api/shutdowns/${shutdownId}/files`)
      .attach('files', Buffer.from('col1,col2'), 'checklist.csv').expect(201);
  });

  it('חבר קבוצה רואה את רשימת הקבצים ומוריד עם התוכן המקורי', async () => {
    const list = await member.get(`/api/shutdowns/${shutdownId}/files`).expect(200);
    expect(list.body.files.length).toBe(2);
    expect(list.body.can_manage).toBe(false);
    fileId = list.body.files.find(f => f.original_name === 'נוהל-השבתה.pdf').id;

    const dl = await member.get(`/api/shutdowns/${shutdownId}/files/${fileId}`)
      .buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
    expect(Buffer.compare(dl.body, pdfContent)).toBe(0);
    expect(dl.headers['content-disposition']).toContain('attachment');
  });

  it('משתמש זר לא יכול להוריד קובץ', async () => {
    await outsider.get(`/api/shutdowns/${shutdownId}/files/${fileId}`).expect(403);
  });

  it('הודעת מערכת על צירוף קובץ נוצרה בצ׳אט', async () => {
    const r = await member.get(`/api/shutdowns/${shutdownId}/messages`).expect(200);
    expect(r.body.messages.some(m => m.type === 'system' && m.body.includes('📎'))).toBe(true);
  });

  it('חבר רגיל לא יכול למחוק, מנהל כן', async () => {
    await member.del(`/api/shutdowns/${shutdownId}/files/${fileId}`).expect(403);
    await manager.del(`/api/shutdowns/${shutdownId}/files/${fileId}`).expect(200);
    const list = await member.get(`/api/shutdowns/${shutdownId}/files`).expect(200);
    expect(list.body.files.length).toBe(1);
  });
});

describe('צ׳אט והתראות', () => {
  it('הודעות מערכת נרשמו בצ׳אט לאורך התהליך', async () => {
    const r = await member.get(`/api/shutdowns/${shutdownId}/messages`).expect(200);
    const system = r.body.messages.filter(m => m.type === 'system');
    expect(system.length).toBeGreaterThan(4);
    expect(r.body.chat_open).toBe(false); // ההשבתה הסתיימה — הצ'אט נעול
  });

  it('נשלחו התראות לחברי הקבוצה', async () => {
    const r = await member.get('/api/notifications').expect(200);
    expect(r.body.notifications.length).toBeGreaterThan(0);
  });

  it('ייצוא ICS עובד', async () => {
    const r = await member.get(`/api/calendar/shutdowns/${shutdownId}/ics`).expect(200);
    expect(r.text).toContain('BEGIN:VCALENDAR');
    expect(r.text).toContain('DTSTART');
  });
});
