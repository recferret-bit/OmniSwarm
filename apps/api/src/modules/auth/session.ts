// `sid` session: an httpOnly, SameSite=Lax cookie signed by @fastify/cookie (HMAC with
// SESSION_SECRET) whose value is {account, expiry}. Stateless, so any replica can read it.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '../../shared/errors.ts';

export const SESSION_COOKIE = 'sid';
const TTL_MS = 24 * 60 * 60 * 1000;

export function setSession(reply: FastifyReply, account: string, now: Date, secure: boolean): void {
  const value = Buffer.from(JSON.stringify({ a: account, e: now.getTime() + TTL_MS })).toString('base64url');
  reply.setCookie(SESSION_COOKIE, value, { signed: true, httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: TTL_MS / 1000 });
}

/** The signed-in account, or 401. A forged, tampered or expired cookie is the same as none. */
export function requireAccount(request: FastifyRequest, now: Date): string {
  const raw = request.cookies[SESSION_COOKIE];
  const unsigned = raw ? request.unsignCookie(raw) : null;
  if (unsigned?.valid && unsigned.value) {
    try {
      const session = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')) as { a?: unknown; e?: unknown };
      if (typeof session.a === 'string' && typeof session.e === 'number' && session.e > now.getTime()) return session.a;
    } catch {
      // fall through to 401
    }
  }
  fail('UNAUTHORIZED', 'Sign in required');
}
