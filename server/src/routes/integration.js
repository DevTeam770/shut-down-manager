// סטטוס אינטגרציות לרשת סגורה — מנהל מערכת בלבד.
// מראה אילו חיבורים חיצוניים מוגדרים (מייל/AD) כדי לדעת מה כבר "מסונכרן".
import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { mailEnabled } from '../services/mailer.js';
import { directoryEnabled } from '../services/directory.js';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  res.json({
    integrations: [
      {
        key: 'mail',
        title: 'מייל (Exchange/SMTP)',
        enabled: mailEnabled(),
        env: 'SMTP_HOST',
        note: 'שליחת התראות והודעות מנהלה ל-Outlook. מופעל במילוי SMTP_HOST ב-.env.'
      },
      {
        key: 'directory',
        title: 'משתמשים מ-Active Directory',
        enabled: directoryEnabled(),
        env: 'LDAP_URL',
        note: 'התחברות עם משתמש הרשת. מימוש ב-server/src/services/directory.js (ראו [INTEGRATION: closed-network]).'
      },
      {
        key: 'calendar',
        title: 'ייצוא ל-Outlook (יומן)',
        enabled: true,
        env: '—',
        note: 'זמין תמיד: קובץ ICS פר-השבתה ומנוי webcal ב-/api/calendar/my.ics.'
      }
    ]
  });
});

export default router;
