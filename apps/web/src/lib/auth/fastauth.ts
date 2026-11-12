// NEAR FastAuth (Auth0) for Google and X. The state prefix is `omni-fastauth`
// so a TerraAgent login on the same origin does not consume this callback.
import { sha256Base64Url } from './pkce';

export const FASTAUTH_ISSUER = 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/';
export const FASTAUTH_CLIENT_ID = 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL';
export const FASTAUTH_STATE_PREFIX = 'omni-fastauth:';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export interface FastAuthState {
  provider: 'google' | 'x';
  verifier: string;
  redirectUri: string;
  retried: boolean;
}

export interface OauthHit {
  provider: 'google' | 'x';
  token: string;
}

function randomVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length] ?? 'A';
  return out;
}

export function fastAuthRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/auth/callback`;
}

export function buildFastAuthLoginUrl(
  origin: string,
  provider: 'google' | 'x',
  opts?: { readonly universalFallback?: boolean; readonly verifier?: string },
): string {
  const redirectUri = fastAuthRedirectUri(origin);
  const verifier = opts?.verifier ?? randomVerifier();
  const state = `${FASTAUTH_STATE_PREFIX}${provider}:${verifier}:${encodeURIComponent(redirectUri)}${opts?.universalFallback ? ':fallback' : ''}`;
  const authorize = new URL('authorize', FASTAUTH_ISSUER);
  authorize.searchParams.set('client_id', FASTAUTH_CLIENT_ID);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', 'openid profile email');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', sha256Base64Url(verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');
  if (!opts?.universalFallback) {
    authorize.searchParams.set('connection', provider === 'google' ? 'google-oauth2' : 'twitter');
  }
  return authorize.toString();
}

/** Third colon-separated field is the verifier; the fourth is the redirect URI. */
export function parseFastAuthState(state: string, origin: string): FastAuthState | null {
  if (!state.startsWith(FASTAUTH_STATE_PREFIX)) return null;
  const [, rawProvider, verifier = '', encodedRedirect = '', marker = ''] = state.split(':');
  if ((rawProvider !== 'google' && rawProvider !== 'x') || !verifier) return null;
  const redirectUri = encodedRedirect ? decodeURIComponent(encodedRedirect) : fastAuthRedirectUri(origin);
  return { provider: rawProvider, verifier, redirectUri, retried: marker === 'fallback' };
}

export function fastAuthCodeToken(code: string, verifier: string, redirectUri: string): string {
  return `fastauth-code:${encodeURIComponent(code)}:${encodeURIComponent(verifier)}:${encodeURIComponent(redirectUri)}`;
}

export function readFastAuthCallback(origin: string, params: URLSearchParams): OauthHit | null {
  const parsed = parseFastAuthState(params.get('state') ?? '', origin);
  const code = (params.get('code') ?? '').trim();
  if (!parsed || !code) return null;
  return { provider: parsed.provider, token: fastAuthCodeToken(code, parsed.verifier, parsed.redirectUri) };
}

/** X only, and only once: the retried state is marked `:fallback` and drops `connection`. */
export function fastAuthRetryUrl(origin: string, params: URLSearchParams): string | null {
  const description = (params.get('error_description') ?? '').toLowerCase();
  if (!description.includes('connection is not enabled')) return null;
  const parsed = parseFastAuthState(params.get('state') ?? '', origin);
  if (!parsed || parsed.provider !== 'x' || parsed.retried) return null;
  return buildFastAuthLoginUrl(origin, 'x', { universalFallback: true, verifier: parsed.verifier });
}

/** Accept only `omni:oauth` from the popup this page opened, on this origin. */
export function readOauthMessage(
  event: { origin: string; source: unknown; data: unknown },
  popup: Window | null,
  origin: string,
): OauthHit | null {
  if (event.origin !== origin || popup == null || event.source !== popup) return null;
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const record = data as { type?: unknown; provider?: unknown; token?: unknown };
  if (record.type !== 'omni:oauth') return null;
  if (record.provider !== 'google' && record.provider !== 'x') return null;
  if (typeof record.token !== 'string' || record.token.length === 0) return null;
  return { provider: record.provider, token: record.token };
}
