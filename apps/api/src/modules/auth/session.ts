// `sid` session: an httpOnly, SameSite=Lax cookie signed by @fastify/cookie (HMAC with
// SESSION_SECRET). Value is {a, e, l?, p?}: account, expiry, optional label, optional provider.
// Stateless, so any replica can read it. A cookie that only has {a, e} still signs in.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '../../shared/errors.ts';

export const SESSION_COOKIE = 'sid';
const TTL_MS = 24 * 60 * 60 * 1000;
const PROVIDERS = ['password', 'near', 'google', 'x'] as const;

export type SessionProvider = (typeof PROVIDERS)[number];

export interface SessionView {
  account: string;
  label?: string;
  provider?: SessionProvider;
}

function isProvider(value: unknown): value is SessionProvider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

export function setSession(
  reply: FastifyReply,
  account: string,
  now: Date,
  secure: boolean,
  extra?: { label?: string; provider?: SessionProvider },
): void {
  const body: { a: string; e: number; l?: string; p?: SessionProvider } = { a: account, e: now.getTime() + TTL_MS };
  if (extra?.label) {
    const label = extra.label.slice(0, 128);
    if (label.length > 0) body.l = label;
  }
  if (extra?.provider && isProvider(extra.provider)) body.p = extra.provider;
  const value = Buffer.from(JSON.stringify(body)).toString('base64url');
  reply.setCookie(SESSION_COOKIE, value, { signed: true, httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: TTL_MS / 1000 });
}

/** The signed-in session, or null when the cookie is missing, bad or expired. Does not throw. */
export function readSession(request: FastifyRequest, now: Date): SessionView | null {
  try {
    const raw = request.cookies[SESSION_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    if (!unsigned?.valid || !unsigned.value) return null;
    const session = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')) as { a?: unknown; e?: unknown; l?: unknown; p?: unknown };
    if (typeof session.a !== 'string' || typeof session.e !== 'number' || session.e <= now.getTime()) return null;
    const view: SessionView = { account: session.a };
    if (typeof session.l === 'string' && session.l.length >= 1 && session.l.length <= 128) view.label = session.l;
    if (isProvider(session.p)) view.provider = session.p;
    return view;
  } catch {
    return null;
  }
}

/** The signed-in account, or 401. A forged, tampered or expired cookie is the same as none. */
export function requireAccount(request: FastifyRequest, now: Date): string {
  const session = readSession(request, now);
  if (!session) fail('UNAUTHORIZED', 'Sign in required');
  return session.account;
}
