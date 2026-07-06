import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import config from './config.js';

fs.mkdirSync(config.logDir, { recursive: true });

// לוג לקובץ + למסך. pino כותב JSON מובנה — קל לחיפוש ברשת סגורה ללא כלים חיצוניים
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      {
        target: 'pino/file',
        options: { destination: path.join(config.logDir, 'server.log'), mkdir: true }
      },
      {
        target: 'pino/file',
        options: { destination: 1 } // stdout
      }
    ]
  }
});

export default logger;
