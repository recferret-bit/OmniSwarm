// Google and X sign-in through the FastAuth Auth0 app: PKCE code exchange, then an RS256 id_token.
// The session account is a hash of provider and subject, never the raw Auth0 sub (it contains `|`).
import crypto from 'node:crypto';
import { fail } from '../../shared/errors.ts';

export const FASTAUTH_ISSUER = 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/';
export const FASTAUTH_CLIENT_ID = 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL';

const TOKEN_TIMEOUT_MS = 8_000;
const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;
// Auth0 names the X connection `twitter` (FastAuth authorize `connection=twitter`).
const SUBJECT_PREFIX = { google: 'google-oauth2|', x: 'twitter|' } as const;

export type SocialProvider = 'google' | 'x';

export interface SocialLoginInput {
  provider: SocialProvider;
  token: string;
}

export interface SocialSession {
  account: string;
  label: string;
  provider: SocialProvider;
}

interface Jwk extends crypto.JsonWebKey {
  kid?: string;
}

interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
}

interface JwtClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  sub?: unknown;
  email?: unknown;
}

export function socialAccountId(provider: SocialProvider, subject: string): string {
  const hash = crypto.createHash('sha256').update(`${provider}:${subject}`).digest('hex').slice(0, 40);
  return `${provider === 'google' ? 'g' : 'x'}.${hash}`;
}

/** http(s), no userinfo, pathname exactly `/auth/callback`, no query and no fragment. */
export function redirectUriAllowed(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.pathname !== '/auth/callback') return false;
  if (url.search || url.hash) return false;
  return true;
}

function parseFastAuthToken(token: string): { code: string; verifier: string; redirectUri: string } {
  if (!token.startsWith('fastauth-code:')) fail('UNAUTHORIZED', 'Sign in failed');
  const parts = token.split(':');
  if (parts.length !== 4) fail('UNAUTHORIZED', 'Sign in failed');
  const rawCode = parts[1] ?? '';
  const rawVerifier = parts[2] ?? '';
  const rawRedirect = parts[3] ?? '';
  let code = '';
  let verifier = '';
  let redirectUri = '';
  try {
    code = decodeURIComponent(rawCode).trim();
    verifier = decodeURIComponent(rawVerifier).trim();
    redirectUri = decodeURIComponent(rawRedirect).trim();
  } catch {
    fail('UNAUTHORIZED', 'Sign in failed');
  }
  if (!code || !verifier || !redirectUri) fail('UNAUTHORIZED', 'Sign in failed');
  return { code, verifier, redirectUri };
}

function readPart(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    fail('UNAUTHORIZED', 'Sign in failed');
  }
}

function verifyIdToken(token: string, keys: readonly Jwk[]): { subject: string; email: string | null } {
  const parts = token.split('.');
  const headerPart = parts[0];
  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (parts.length !== 3 || !headerPart || !payloadPart || !signaturePart) fail('UNAUTHORIZED', 'Sign in failed');
  const header = readPart(headerPart) as JwtHeader;
  const claims = readPart(payloadPart) as JwtClaims;
  if (!header || typeof header !== 'object' || header.alg !== 'RS256') fail('UNAUTHORIZED', 'Sign in failed');
  const signature = Buffer.from(signaturePart, 'base64url');
  const signingInput = Buffer.from(`${headerPart}.${payloadPart}`, 'utf8');
  const kid = typeof header.kid === 'string' ? header.kid : '';
  const candidates = kid ? keys.filter((key) => key.kid === kid) : keys;
  if (candidates.length === 0) fail('UNAUTHORIZED', 'Sign in failed');
  const verified = candidates.some((jwk) => {
    try {
      const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      return crypto.verify('RSA-SHA256', signingInput, pub, signature);
    } catch {
      return false;
    }
  });
  if (!verified) fail('UNAUTHORIZED', 'Sign in failed');
  const iss = typeof claims.iss === 'string' ? claims.iss : '';
  const allowed = [FASTAUTH_ISSUER, FASTAUTH_ISSUER.replace(/\/$/, '')];
  if (!allowed.includes(iss)) fail('UNAUTHORIZED', 'Sign in failed');
  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  if (exp <= Math.floor(Date.now() / 1000)) fail('UNAUTHORIZED', 'Sign in failed');
  const aud = claims.aud;
  const audList = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : [];
  if (!audList.includes(FASTAUTH_CLIENT_ID)) fail('UNAUTHORIZED', 'Sign in failed');
  const subject = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  if (!subject) fail('UNAUTHORIZED', 'Sign in failed');
  const email = typeof claims.email === 'string' && claims.email.trim() ? claims.email.trim() : null;
  return { subject, email };
}

async function postToken(fetchImpl: typeof fetch, code: string, verifier: string, redirectUri: string): Promise<string> {
  const response = await fetchImpl(`${FASTAUTH_ISSUER}oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: FASTAUTH_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  }).catch(() => fail('UNAUTHORIZED', 'Sign in failed'));
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    fail('UNAUTHORIZED', 'Sign in failed');
  }
  const payload: unknown = await response.json().catch(() => fail('UNAUTHORIZED', 'Sign in failed'));
  const idToken = payload && typeof payload === 'object' && 'id_token' in payload ? payload.id_token : undefined;
  if (typeof idToken !== 'string' || !idToken) fail('UNAUTHORIZED', 'Sign in failed');
  return idToken;
}

async function fetchJwks(fetchImpl: typeof fetch): Promise<Jwk[]> {
  const response = await fetchImpl(`${FASTAUTH_ISSUER}.well-known/jwks.json`, {
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  }).catch(() => fail('UNAUTHORIZED', 'Sign in failed'));
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    fail('UNAUTHORIZED', 'Sign in failed');
  }
  const payload: unknown = await response.json().catch(() => fail('UNAUTHORIZED', 'Sign in failed'));
  const listed = payload && typeof payload === 'object' && 'keys' in payload ? payload.keys : undefined;
  if (!Array.isArray(listed)) fail('UNAUTHORIZED', 'Sign in failed');
  const keys = listed.filter((key): key is Jwk => Boolean(key) && typeof key === 'object');
  if (keys.length === 0) fail('UNAUTHORIZED', 'Sign in failed');
  return keys;
}

function labelFor(provider: SocialProvider, email: string | null): string {
  const fallback = provider === 'google' ? 'Google' : 'X';
  return (email ?? fallback).slice(0, 128);
}

/** Exchange a `fastauth-code:` PKCE token and derive the session account. `fetchImpl` defaults to global fetch. */
export async function loginSocial(input: SocialLoginInput, fetchImpl: typeof fetch = globalThis.fetch): Promise<SocialSession> {
  const { code, verifier, redirectUri } = parseFastAuthToken(input.token);
  if (!redirectUriAllowed(redirectUri)) fail('UNAUTHORIZED', 'Sign in failed');
  const idToken = await postToken(fetchImpl, code, verifier, redirectUri);
  const claims = verifyIdToken(idToken, await fetchJwks(fetchImpl));
  if (!claims.subject.startsWith(SUBJECT_PREFIX[input.provider])) fail('UNAUTHORIZED', 'Sign in failed');
  const account = socialAccountId(input.provider, claims.subject);
  if (!ACCOUNT_ID.test(account)) fail('UNAUTHORIZED', 'Sign in failed');
  return { account, label: labelFor(input.provider, claims.email), provider: input.provider };
}
