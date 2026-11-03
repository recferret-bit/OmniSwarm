// What a log value may carry (INTAKE section 5 "Logs"). Every log call passes through here:
// - a field whose name ends in authorization, cookie, token, secret, password, signature or key (any
//   case, any separators: x-admin-token, sessionSecret, OPERATOR_KEY) is replaced by REDACTED, at any depth;
// - an http(s)/ws(s) URL in any string is cut to its origin, so a provider key in an RPC_URLS path or query
//   never reaches a log; any other URL loses its user:password (DATABASE_URL);
// - errors are walked with their cause chain, aggregate errors and own fields, all scrubbed the same way.
import net from 'node:net';

export const REDACTED = '[redacted]';
const MAX_DEPTH = 8;
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|signature|key)$/;
const WEB_URL = /\b(?:https?|wss?):\/\/[^\s'"<>`]+/gi;
const USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"<>`]+@/gi;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.toLowerCase().replace(/[^a-z]/g, ''));
}

function origin(url: string): string {
  try { return new URL(url).origin; }
  catch { return '[url]'; }
}

export function scrubText(text: string): string {
  return text.replace(WEB_URL, origin).replace(USERINFO, `$1${REDACTED}@`);
}

function scrubFields(entries: Iterable<[string, unknown]>, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) out[key] = isSensitiveKey(key) ? REDACTED : scrub(value, depth + 1, seen);
  return out;
}

function errorEntries(error: Error): [string, unknown][] {
  const entries: [string, unknown][] = [['type', error.constructor?.name || error.name], ['message', error.message], ['stack', error.stack]];
  if (error.cause !== undefined) entries.push(['cause', error.cause]);
  if (error instanceof AggregateError) entries.push(['aggregateErrors', error.errors]);
  for (const [key, value] of Object.entries(error)) if (!entries.some(([name]) => name === key)) entries.push([key, value]);
  return entries;
}

/** A JSON-safe copy of `value` with secrets removed; Error instances become {type, message, stack, cause, ...}. */
export function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return `[${value.byteLength} bytes]`;
  seen.add(value);
  const copy = value instanceof Error ? scrubFields(errorEntries(value), depth, seen)
    : Array.isArray(value) ? value.map((item) => scrub(item, depth + 1, seen))
      : scrubFields(Object.entries(value), depth, seen);
  seen.delete(value); // only the current path counts as a cycle; a value logged twice is kept twice
  return copy;
}

/** The path of a request URL, without its query string or fragment. */
export function pathOnly(url: string | undefined): string {
  return (url ?? '').replace(/[?#].*$/s, '');
}

function ipv6Groups(address: string): string[] {
  const [head = '', tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return groups.map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''));
}

/** A client address truncated like nginx's access log: IPv4 to its /24, IPv6 to its /48. */
export function truncateIp(ip: string | undefined): string {
  const address = (ip ?? '').split('%')[0] ?? '';
  const v4 = /^(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/i.exec(address);
  if (v4) return `${v4[1]}.0`;
  if (net.isIPv6(address)) return `${ipv6Groups(address).slice(0, 3).join(':')}::`;
  return '-';
}
