import { describe, expect, it } from 'vitest';
import { buildFastAuthLoginUrl, fastAuthRetryUrl, readFastAuthCallback, readOauthMessage } from './fastauth';

const ORIGIN = 'https://omniswarm.localhost';

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('buildFastAuthLoginUrl', () => {
  it('builds a Google authorize URL with PKCE S256 and an omni-fastauth state', async () => {
    const url = new URL(buildFastAuthLoginUrl(ORIGIN, 'google', { verifier: 'verifier-value' }));
    expect(url.href).toContain('connection=google-oauth2');
    expect(url.href).toContain('client_id=GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL');
    expect(url.href).toContain('code_challenge_method=S256');
    expect(url.searchParams.get('state')).toMatch(/^omni-fastauth:/);
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('code_challenge')).toBe(await s256('verifier-value'));
  });

  it('uses the twitter connection for X and retries once without it', () => {
    const url = new URL(buildFastAuthLoginUrl(ORIGIN, 'x', { verifier: 'verifier-value' }));
    expect(url.href).toContain('connection=twitter');
    expect(url.searchParams.get('state')).toMatch(/^omni-fastauth:/);

    const state = url.searchParams.get('state') ?? '';
    const retry = fastAuthRetryUrl(ORIGIN, new URLSearchParams({ state, error_description: 'The connection is not enabled' }));
    expect(retry).toBeTruthy();
    const fallback = new URL(retry!);
    expect(fallback.searchParams.get('connection')).toBeNull();
    expect(fallback.searchParams.get('state')).toMatch(/^omni-fastauth:/);
    expect(fastAuthRetryUrl(ORIGIN, new URLSearchParams({
      state: fallback.searchParams.get('state') ?? '',
      error_description: 'connection is not enabled',
    }))).toBeNull();
  });

  it('builds the callback token from the third and fourth state fields', () => {
    const state = new URL(buildFastAuthLoginUrl(ORIGIN, 'google', { verifier: 'verifier-value' })).searchParams.get('state') ?? '';
    const hit = readFastAuthCallback(ORIGIN, new URLSearchParams({ code: 'abc/def', state }));
    expect(hit).toEqual({
      provider: 'google',
      token: `fastauth-code:${encodeURIComponent('abc/def')}:${encodeURIComponent('verifier-value')}:${encodeURIComponent(`${ORIGIN}/auth/callback`)}`,
    });
  });

  it('ignores an oauth message that is not from the popup on this origin', () => {
    const popup = {} as Window;
    const data = { type: 'omni:oauth', provider: 'google', token: 'fastauth-code:a:b:c' };
    expect(readOauthMessage({ origin: ORIGIN, source: popup, data }, popup, ORIGIN)).toEqual({ provider: 'google', token: data.token });
    expect(readOauthMessage({ origin: 'https://evil.example', source: popup, data }, popup, ORIGIN)).toBeNull();
    expect(readOauthMessage({ origin: ORIGIN, source: {} as Window, data }, popup, ORIGIN)).toBeNull();
    expect(readOauthMessage({ origin: ORIGIN, source: popup, data: { type: 'terra:mock-token', provider: 'google', token: 'x' } }, popup, ORIGIN)).toBeNull();
  });
});
