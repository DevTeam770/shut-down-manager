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

// שתי המשמעויות חובה בכל תגובה — קיצור לשימוש חוזר בבדיקות
const IMP = { impact_text: 'משמעות מחלקתית', impact_general: 'משמעות כללית על כלל המערכת' };

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

  it('תגובה ללא שתי המשמעויות נדחית (חובה)', async () => {
    await member.post(`/api/shutdowns/${shutdownId}/respond`)
      .send({ response: 'approved', impact_text: 'רק מחלקתי' }).expect(400);
    await member.post(`/api/shutdowns/${shutdownId}/respond`)
      .send({ response: 'approved' }).expect(400);
  });

  it('תגובה מותנית עם תנאי ותאריך חלופי מתקבלת', async () => {
    const r = await member.post(`/api/shutdowns/${shutdownId}/respond`)
      .send({ response: 'conditional', condition_text: 'תלוי בסיום גיבוי', alternative_date: '2026-08-22', ...IMP })
      .expect(200);
    const a = r.body.shutdown.approvals.find(x => x.user_id === memberId);
    expect(a.alternative_date).toBe('2026-08-22');
    expect(a.impact_general).toBe(IMP.impact_general);
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

  it('מנהל מאמץ תאריך חלופי — סבב אישורים מתאפס (היוזם נשאר מאושר)', async () => {
    const r = await manager.post(`/api/shutdowns/${shutdownId}/adopt-date`)
      .send({ from_user_id: memberId }).expect(200);
    expect(r.body.shutdown.proposed_date).toBe('2026-08-22');
    // אחרי איפוס נשאר רק אישור היוזם האוטומטי (moshe)
    expect(r.body.shutdown.approvals.length).toBe(1);
    expect(r.body.shutdown.approvals[0].user_id).toBe(managerId);
    expect(r.body.shutdown.is_final_date).toBe(0);
  });
});

describe('קיבוע תאריך ומעברי סטטוס', () => {
  it('כולם מאשרים ומקבעים תאריך סופי', async () => {
    await member.post(`/api/shutdowns/${shutdownId}/respond`).send({ response: 'approved', ...IMP }).expect(200);
    await manager.post(`/api/shutdowns/${shutdownId}/respond`).send({ response: 'approved', ...IMP }).expect(200);
    const r = await manager.patch(`/api/shutdowns/${shutdownId}`).send({ is_final_date: true }).expect(200);
    expect(r.body.shutdown.is_final_date).toBe(1);
    expect(r.body.shutdown.status).toBe('confirmed');
  });

  it('אחרי קיבוע — אי אפשר להגיב יותר', async () => {
    await member.post(`/api/shutdowns/${shutdownId}/respond`).send({ response: 'rejected', ...IMP }).expect(400);
  });

  it('מעבר סטטוס לא חוקי נדחה (confirmed -> completed)', async () => {
    await manager.patch(`/api/shutdowns/${shutdownId}`).send({ status: 'completed' }).expect(400);
  });

  it('חבר רגיל לא יכול לשנות סטטוס', async () => {
    await member.patch(`/api/shutdowns/${shutdownId}`).send({ status: 'in_progress' }).expect(403);
  });

  it('סיכום לפני סיום נדחה (admin, טרם הסתיימה)', async () => {
    await admin.post(`/api/shutdowns/${shutdownId}/review`)
      .send({ score: 8 }).expect(400);
  });

  it('מנהל השבתה שאינו admin אינו יכול לכתוב סיכום/ציון', async () => {
    await manager.post(`/api/shutdowns/${shutdownId}/review`)
      .send({ summary: 'x', score: 5 }).expect(403);
  });

  it('מעבר מלא: ביצוע -> סיום -> סיכום (סיכום ע"י הנהלה)', async () => {
    await manager.patch(`/api/shutdowns/${shutdownId}`).send({ status: 'in_progress' }).expect(200);
    await manager.patch(`/api/shutdowns/${shutdownId}`).send({ status: 'completed' }).expect(200);
    const r = await admin.post(`/api/shutdowns/${shutdownId}/review`)
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
    await member.post(`/api/shutdowns/${sid2}/respond`).send({ response: 'approved', ...IMP });
    await manager.post(`/api/shutdowns/${sid2}/respond`).send({ response: 'approved', ...IMP });
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

  it('ייצוא CSV — דוח הנהלה (admin) בלבד; משתמש רגיל נחסם', async () => {
    // משתמש רגיל / זר — חסום (הדוח מכיל ציונים)
    await member.get('/api/stats/export.csv').expect(403);
    await outsider.get('/api/stats/export.csv').expect(403);
    // admin מקבל דוח מלא עם BOM וציונים
    const r = await admin.get('/api/stats/export.csv').expect(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.text.charCodeAt(0)).toBe(0xFEFF); // BOM לזיהוי עברית ב-Excel
    expect(r.text).toContain('שדרוג מתגי ליבה');
    expect(r.text).toContain('ציון');
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

describe('שדרוגים בינוניים: באנר, צ׳קליסט, משוב, חיפושים, mailer', () => {
  let sid3;

  it('ביטול השבתה בביצוע מוריד אותה מ-active-now (תיקון הבאנר)', async () => {
    const r = await manager.post('/api/shutdowns').send({
      group_id: groupId, title: 'השבתה לביטול', proposed_date: '2027-07-07',
      checklist: [{ text: 'לגבות קונפיגורציה', phase: 'before' }, { text: 'להרים שירותים', phase: 'after' }]
    }).expect(201);
    sid3 = r.body.shutdown.id;
    expect(r.body.shutdown.checklist.length).toBe(2); // הצ'קליסט נוצר עם ההשבתה

    const db = (await import('../src/db/db.js')).default;
    db.prepare(`UPDATE shutdowns SET status = 'in_progress' WHERE id = ?`).run(sid3);
    let active = await manager.get('/api/shutdowns/active-now').expect(200);
    expect(active.body.active.some(a => a.id === sid3)).toBe(true);

    await manager.patch(`/api/shutdowns/${sid3}`).send({ status: 'cancelled' }).expect(200);
    active = await manager.get('/api/shutdowns/active-now').expect(200);
    expect(active.body.active.some(a => a.id === sid3)).toBe(false);
  });

  it('צ׳קליסט: חבר מסמן ביצוע, רק מנהל מוסיף ומוחק', async () => {
    const r = await manager.post('/api/shutdowns').send({
      group_id: groupId, title: 'השבתה עם צ׳קליסט', proposed_date: '2027-08-08'
    }).expect(201);
    const sid = r.body.shutdown.id;

    await member.post(`/api/shutdowns/${sid}/checklist`).send({ text: 'אסור לי', phase: 'before' }).expect(403);
    const item = await manager.post(`/api/shutdowns/${sid}/checklist`)
      .send({ text: 'לתאם עם ספק', phase: 'before' }).expect(201);

    await member.patch(`/api/shutdowns/${sid}/checklist/${item.body.id}`).send({ done: true }).expect(200);
    let full = await member.get(`/api/shutdowns/${sid}`).expect(200);
    const it1 = full.body.shutdown.checklist.find(c => c.id === item.body.id);
    expect(it1.done).toBe(1);
    expect(it1.done_by_name).toBe('דנה');

    await member.del(`/api/shutdowns/${sid}/checklist/${item.body.id}`).expect(403);
    await manager.del(`/api/shutdowns/${sid}/checklist/${item.body.id}`).expect(200);
  });

  it('משוב: רק אחרי סיום, upsert, ממוצע נראה להנהלה בלבד', async () => {
    // ההשבתה שהסתיימה מהבדיקות הקודמות (shutdownId הראשי הסתיימה כבר)
    await member.post(`/api/shutdowns/${shutdownId}/feedback`).send({ score: 8, comment: 'עבר חלק' }).expect(200);
    await member.post(`/api/shutdowns/${shutdownId}/feedback`).send({ score: 6, comment: 'עדכון' }).expect(200); // upsert
    await manager.post(`/api/shutdowns/${shutdownId}/feedback`).send({ score: 10 }).expect(200);

    // admin (הנהלה) רואה את כל המשוב והממוצע
    const asAdmin = await admin.get(`/api/shutdowns/${shutdownId}`).expect(200);
    expect(asAdmin.body.shutdown.feedback.length).toBe(2);
    expect(asAdmin.body.shutdown.avg_feedback).toBe(8); // (6+10)/2

    // משתמש רגיל רואה רק את המשוב שלו, בלי ממוצע ובלי ציון הסיכום
    const asMember = await member.get(`/api/shutdowns/${shutdownId}`).expect(200);
    expect(asMember.body.shutdown.feedback.length).toBe(1);
    expect(asMember.body.shutdown.feedback[0].user_id).toBe(memberId);
    expect(asMember.body.shutdown.avg_feedback).toBe(null);
    expect(asMember.body.shutdown.review).toBe(null);

    // השבתה שעדיין לא הסתיימה — נדחה
    await member.post(`/api/shutdowns/${sid3}/feedback`).send({ score: 5 }).expect(400);
  });

  it('חיפוש בהודעות צ׳אט (q)', async () => {
    const r = await member.get(`/api/shutdowns/${shutdownId}/messages?q=אישר`).expect(200);
    expect(r.body.messages.length).toBeGreaterThan(0);
    expect(r.body.messages.every(m => m.body.includes('אישר'))).toBe(true);
  });

  it('חיפוש גלובלי מכבד הרשאות', async () => {
    const r = await member.get('/api/search?q=מתגי').expect(200);
    expect(r.body.shutdowns.length).toBeGreaterThan(0);
    // משתמש זר — לא רואה כלום
    const foreign = await outsider.get('/api/search?q=מתגי').expect(200);
    expect(foreign.body.shutdowns.length).toBe(0);
    expect(foreign.body.messages.length).toBe(0);
  });

  it('mailer כבוי כשאין SMTP_HOST (no-op בטוח)', async () => {
    const { mailEnabled, mailUsers } = await import('../src/services/mailer.js');
    expect(mailEnabled()).toBe(false);
    expect(() => mailUsers([memberId], 'נושא', 'תוכן')).not.toThrow();
  });

  it('משתמש נוצר עם מייל ומתעדכן', async () => {
    const r = await admin.post('/api/users')
      .send({ username: 'mailuser', password: 'pass123', display_name: 'עם מייל', email: 'user@corp.local' })
      .expect(201);
    const upd = await admin.patch(`/api/users/${r.body.user.id}`).send({ email: 'new@corp.local' }).expect(200);
    expect(upd.body.user).toBeTruthy();
    await admin.post('/api/users')
      .send({ username: 'badmail', password: 'pass123', display_name: 'רע', email: 'לא-מייל' })
      .expect(400);
  });
});

describe('חבילת לינור: הודעות, צ׳קליסט פרטי, משמעויות+מסמך, נהלים', () => {
  it('לינור קיימת כמנהלת מערכת', async () => {
    const linor = request.agent(app);
    const r = await linor.post('/api/auth/login').send({ username: 'Linor', password: 'Linor123' }).expect(200);
    expect(r.body.user.role).toBe('admin');
  });

  it('הודעה לכולם: admin שולח, כולם מקבלים, לא-admin נחסם', async () => {
    await member.post('/api/announcements').send({ body: 'ניסיון אסור' }).expect(403);
    const before = (await member.get('/api/notifications')).body.notifications.length;
    const r = await admin.post('/api/announcements').send({ body: 'תחזוקה מתוכננת מחר', email_all: true }).expect(201);
    expect(r.body.recipients).toBeGreaterThan(0);
    expect(r.body.mail_sent).toBe(false); // אין SMTP בבדיקות
    const after = (await member.get('/api/notifications')).body.notifications.length;
    expect(after).toBe(before + 1);
  });

  it('צ׳קליסט פרטי: רק admin רואה ורק admin יוצר', async () => {
    const r = await manager.post('/api/shutdowns').send({
      group_id: groupId, title: 'השבתה עם צ׳קליסט פרטי', proposed_date: '2027-09-09'
    }).expect(201);
    const sid = r.body.shutdown.id;

    // מנהל השבתה שאינו admin — לא יכול ליצור פריט פרטי (admin_only מתעלם)
    await manager.post(`/api/shutdowns/${sid}/checklist`).send({ text: 'פריט רגיל', phase: 'before' }).expect(201);
    await admin.post(`/api/shutdowns/${sid}/checklist`).send({ text: 'סוד מנהלים', phase: 'before', admin_only: true }).expect(201);

    const asAdmin = await admin.get(`/api/shutdowns/${sid}`);
    expect(asAdmin.body.shutdown.checklist.length).toBe(2);
    const asMember = await member.get(`/api/shutdowns/${sid}`);
    expect(asMember.body.shutdown.checklist.length).toBe(1); // הפריט הפרטי מסונן
    expect(asMember.body.shutdown.checklist.some(c => c.text === 'סוד מנהלים')).toBe(false);
  });

  it('משמעויות + מסמך מרוכז כשכולם מאשרים', async () => {
    // קבוצה ייעודית עם שני חברים בדיוק: moshe יוצר (מתווסף אוטומטית כמנהל) + dana
    const g = await manager.post('/api/groups').send({ name: 'קבוצת מסמך ' + Date.now() }).expect(201);
    const gid = g.body.group.id;
    await manager.post(`/api/groups/${gid}/members`).send({ user_id: memberId, is_shutdown_manager: false }).expect(201);

    const r = await manager.post('/api/shutdowns').send({
      group_id: gid, title: 'השבתה למסמך', proposed_date: '2027-10-10'
    }).expect(201);
    const sid = r.body.shutdown.id;

    await member.post(`/api/shutdowns/${sid}/respond`)
      .send({ response: 'approved', impact_text: 'שירות הדוחות יורד', impact_general: 'ללא השפעה חוצת-ארגון' }).expect(200);
    let full = await manager.post(`/api/shutdowns/${sid}/respond`)
      .send({ response: 'approved', impact_text: 'אין השפעה על הצוות שלי', impact_general: 'ללא' }).expect(200);
    expect(full.body.shutdown.approvals.find(a => a.user_id === memberId).impact_text).toBe('שירות הדוחות יורד');

    // כל החברים אישרו ⇦ doc_sent נדלק
    const db = (await import('../src/db/db.js')).default;
    expect(db.prepare('SELECT doc_sent FROM shutdowns WHERE id = ?').get(sid).doc_sent).toBe(1);

    // מסמך מרוכז — מנהל מקבל HTML עם המשמעויות; לא-חבר נחסם
    const doc = await manager.get(`/api/shutdowns/${sid}/document`).expect(200);
    expect(doc.headers['content-type']).toContain('text/html');
    expect(doc.text).toContain('שירות הדוחות יורד');
    await outsider.get(`/api/shutdowns/${sid}/document`).expect(403);
  });

  it('נהלי השבתות: admin מעלה, חבר מוריד, לא-admin לא מעלה/מוחק', async () => {
    await member.post('/api/procedures').attach('file', Buffer.from('%PDF-1.4 guide'), 'מדריך.pdf').expect(403);
    await admin.post('/api/procedures').field('title', 'מדריך למשתמש')
      .attach('file', Buffer.from('%PDF-1.4 guide'), 'מדריך.pdf').expect(201);

    const list = await member.get('/api/procedures').expect(200);
    expect(list.body.docs.length).toBe(1);
    expect(list.body.can_manage).toBe(false);
    const docId = list.body.docs[0].id;

    const dl = await member.get(`/api/procedures/${docId}`).expect(200);
    expect(dl.headers['content-disposition']).toContain('inline');
    await member.del(`/api/procedures/${docId}`).expect(403);
    await admin.del(`/api/procedures/${docId}`).expect(200);
  });

  it('קובץ הרצה נחסם בנהלים', async () => {
    await admin.post('/api/procedures').field('title', 'רע')
      .attach('file', Buffer.from('MZ'), 'virus.exe').expect(400);
  });
});

describe('ליטוש: admin יוצר בכל קבוצה, מסמך, פרטי, אינטגרציות', () => {
  it('מנהל מערכת יוצר השבתה בקבוצה שאינו חבר בה', async () => {
    // admin אינו חבר ב-groupId (רק moshe+dana), ובכל זאת רשאי ליצור
    const r = await admin.post('/api/shutdowns').send({
      group_id: groupId, title: 'השבתה שיצר admin', proposed_date: '2027-11-11'
    }).expect(201);
    expect(r.body.shutdown.title).toBe('השבתה שיצר admin');
  });

  it('מסמך מרוכז: ?download=1 מחזיר Content-Disposition attachment', async () => {
    const r = await manager.get(`/api/shutdowns/${shutdownId}/document?download=1`).expect(200);
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.text).toContain('מסמך השבתה מרוכז');
  });

  it('הודעת צ׳אט פרטית נראית רק לשולח/נמען/admin', async () => {
    const db = (await import('../src/db/db.js')).default;
    // moshe (מנהל) שולח הודעה פרטית ל-dana
    db.prepare(
      `INSERT INTO messages (shutdown_id, user_id, body, type, recipient_id) VALUES (?, ?, ?, 'text', ?)`
    ).run(shutdownId, managerId, 'סוד רק לדנה', memberId);

    const asDana = await member.get(`/api/shutdowns/${shutdownId}/messages`).expect(200);
    expect(asDana.body.messages.some(m => m.body === 'סוד רק לדנה')).toBe(true);
    const asAdmin = await admin.get(`/api/shutdowns/${shutdownId}/messages`).expect(200);
    expect(asAdmin.body.messages.some(m => m.body === 'סוד רק לדנה')).toBe(true);

    // חבר שלישי לא רואה — נוסיף משתמש נוסף לקבוצה
    const third = request.agent(app);
    await third.post('/api/auth/register').send({ username: 'third1', password: 'pass123', display_name: 'שלישי' }).expect(201);
    const tid = (await admin.get('/api/users?q=third1')).body.users[0].id;
    await admin.post(`/api/groups/${groupId}/members`).send({ user_id: tid }).expect(201);
    const asThird = await third.get(`/api/shutdowns/${shutdownId}/messages`).expect(200);
    expect(asThird.body.messages.some(m => m.body === 'סוד רק לדנה')).toBe(false);
  });

  it('סטטוס אינטגרציות — admin בלבד, mail/directory כבויים בבדיקות', async () => {
    await member.get('/api/integration-status').expect(403);
    const r = await admin.get('/api/integration-status').expect(200);
    const mail = r.body.integrations.find(i => i.key === 'mail');
    const dir = r.body.integrations.find(i => i.key === 'directory');
    expect(mail.enabled).toBe(false);
    expect(dir.enabled).toBe(false);
    expect(r.body.integrations.find(i => i.key === 'calendar').enabled).toBe(true);
  });

  it('directoryEnabled=false ללא LDAP_URL; התחברות מקומית עובדת', async () => {
    const { directoryEnabled } = await import('../src/services/directory.js');
    expect(directoryEnabled()).toBe(false);
    const local = request.agent(app);
    await local.post('/api/auth/login').send({ username: 'admin', password: 'admin123' }).expect(200);
  });
});

describe('ליטוש נוסף: יוזם מאושר, מסמך סיכום נפרד, ראות ציונים', () => {
  it('יוזם ההשבתה מאושר אוטומטית ואינו נדרש להגיב', async () => {
    const r = await manager.post('/api/shutdowns').send({
      group_id: groupId, title: 'השבתה של היוזם', proposed_date: '2028-01-01'
    }).expect(201);
    const mine = r.body.shutdown.approvals.find(a => a.user_id === managerId);
    expect(mine).toBeTruthy();
    expect(mine.response).toBe('approved');
  });

  it('מסמך סיכום נפרד: admin רואה ציון; מנהל לא-admin נחסם; המסמך המרוכז ללא ציונים', async () => {
    // shutdownId הסתיימה וקיים לה סיכום (ציון 9) ומשוב
    const sum = await admin.get(`/api/shutdowns/${shutdownId}/summary-document`).expect(200);
    expect(sum.headers['content-type']).toContain('text/html');
    expect(sum.text).toContain('מסמך סיכום השבתה');
    expect(sum.text).toContain('9/10');

    // מנהל השבתה שאינו admin — חסום ממסמך הסיכום
    await manager.get(`/api/shutdowns/${shutdownId}/summary-document`).expect(403);

    // המסמך המרוכז (מנהל) — ללא מקטע סיכום/ציון
    const doc = await manager.get(`/api/shutdowns/${shutdownId}/document`).expect(200);
    expect(doc.text).not.toContain('סיכום ההשבתה');
    expect(doc.text).toContain('אישורים ומשמעויות');
  });

  it('ציון ממוצע בדשבורד — הנהלה בלבד', async () => {
    const asMember = await member.get('/api/stats').expect(200);
    expect(asMember.body.avgScore).toBe(null);
    const asAdmin = await admin.get('/api/stats').expect(200);
    expect(asAdmin.body.avgScore).toBe(9);
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
