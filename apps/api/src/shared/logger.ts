// pino for every process (INTAKE section 5 "Logs"). Request logs carry the request id, the method, the path
// without its query string and the client address truncated like nginx's (IPv4 /24, IPv6 /48); never
// headers. Every other logged value, message and error (with its cause chain) goes through log-scrub.ts:
// secret-named fields are redacted at any depth and URLs are cut to their origin, so RPC_URLS keys never
// reach a log. The serializers live on the root logger, so Fastify's request loggers use them too.
import { pino, type DestinationStream, type LogFn, type Logger, type LoggerOptions } from 'pino';
import { isSensitiveKey, pathOnly, REDACTED, scrub, scrubText, truncateIp } from './log-scrub.ts';

export type { Logger };

interface LoggedRequest { method?: string; url?: string; host?: string; ip?: string; socket?: { remoteAddress?: string } }
interface LoggedReply { statusCode?: number }

// Fastify's request and reply objects are passed as-is; their serializers below pick the safe fields.
const SERIALIZED = new Set(['req', 'res']);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const options: LoggerOptions = {
  serializers: {
    req: (req: LoggedRequest) => ({ method: req.method, url: pathOnly(req.url), host: req.host, remoteAddress: truncateIp(req.ip ?? req.socket?.remoteAddress) }),
    res: (res: LoggedReply) => ({ statusCode: res.statusCode }),
    // Replaces pino's err serializer, which would flatten the already scrubbed cause chain.
    err: (err: unknown) => scrub(err),
  },
  formatters: {
    log(object) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(object)) out[key] = SERIALIZED.has(key) ? value : isSensitiveKey(key) ? REDACTED : scrub(value);
      return out;
    },
  },
  hooks: {
    // Strings are scrubbed before pino formats them. pino would take an error's raw message as the log
    // message when none is given (log.error(err), log.error({ err })), so the scrubbed one is passed instead.
    logMethod(args, method) {
      const [first, ...rest] = args as unknown[];
      const error = first instanceof Error ? first : isRecord(first) && first.err instanceof Error ? first.err : null;
      const head = first instanceof Error ? { err: first } : typeof first === 'string' ? scrubText(first) : first;
      const tail = rest.map((arg) => (typeof arg === 'string' ? scrubText(arg) : arg));
      if (error && typeof tail[0] !== 'string' && !(isRecord(head) && 'msg' in head)) tail.unshift(scrubText(error.message));
      method.apply(this, [head, ...tail] as Parameters<LogFn>);
    },
  },
};

/** `destination` defaults to stdout; tests pass a stream to read the lines back. */
export function createLogger(level: string, name: string, destination?: DestinationStream): Logger {
  const config = { ...options, level, name };
  return destination ? pino(config, destination) : pino(config);
}
