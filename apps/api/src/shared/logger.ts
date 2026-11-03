// pino for every process. Request logs carry the request id; signatures, keys, cookies and the admin
// token are redacted (INTAKE section 5 "Logs").
import { pino, type Logger } from 'pino';

export type { Logger };

const REDACT = [
  'req.headers.cookie', 'req.headers.authorization', 'req.headers["x-admin-token"]', 'res.headers["set-cookie"]',
  'signature', 'publicKey', '*.signature', '*.publicKey', '*.privateKey', '*.token',
];

export function createLogger(level: string, name: string): Logger {
  return pino({ level, name, redact: { paths: REDACT, censor: '[redacted]' } });
}
