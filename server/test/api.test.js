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
