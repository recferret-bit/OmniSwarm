// Google, X and NEAR wallet sign-in. No database and no Auth0: PKCE uses a local RSA key.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Db } from '../../src/db/pool.ts';
import type { ApiDeps } from '../../src/http/deps.ts';
import { installErrorHandling } from '../../src/http/error-handler.ts';
import { authRoutes } from '../../src/modules/auth/auth.routes.ts';
import { loginMessage, loginNear, type NearLoginBody, type NearLoginDeps } from '../../src/modules/auth/near-login.ts';
import { encodePublicKey, rawPublicKey, signNep413, verifyNep413 } from '../../src/modules/auth/nep413.ts';
import { readSession, requireAccount, setSession } from '../../src/modules/auth/session.ts';
import { loginSocial, socialAccountId, type SocialProvider } from '../../src/modules/auth/social-login.ts';
import { dashboardRoutes } from '../../src/modules/dashboard/dashboard.routes.ts';
import { AppError, fail } from '../../src/shared/errors.ts';

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;
const RECIPIENT = 'omniswarm.testnet';
const ISSUER = 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/';
const CLIENT_ID = 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL';
const REDIRECT = 'http://127.0.0.1/auth/callback';
const NOW = new Date('2026-11-12T00:00:00Z');

async function rejected(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AppError);
    return error;
  }
  assert.fail('expected AppError');
}

function fastAuthToken(code: string, verifier: string, redirectUri: string): string {
  return `fastauth-code:${encodeURIComponent(code)}:${encodeURIComponent(verifier)}:${encodeURIComponent(redirectUri)}`;
}

function rs256(privateKey: crypto.KeyObject, payload: Record<string, unknown>, kid: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  signer.end();
  return `${header}.${body}.${signer.sign(privateKey).toString('base64url')}`;
}

function idClaims(sub: string, email?: string): Record<string, unknown> {
  return {
    iss: ISSUER, aud: CLIENT_ID, sub, exp: Math.floor(Date.now() / 1000) + 600,
    ...(email ? { email } : {}),
  };
}

interface SeenFetch { urls: string[]; body?: unknown }

function pkceFetch(idToken: string, jwk: crypto.JsonWebKey, seen: SeenFetch): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    seen.urls.push(url);
    if (url === `${ISSUER}oauth/token`) {
      seen.body = JSON.parse(String(init?.body));
      return Response.json({ id_token: idToken });
    }
    if (url === `${ISSUER}.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    throw new Error(`unexpected fetch ${url}`);
  };
}

function nonceJar(): Db & { queries: number } {
  let consumed = false;
  const jar = {
    queries: 0,
    async query(sql: string) {
      jar.queries += 1;
      const text = String(sql);
      if (text.startsWith('UPDATE')) {
        if (consumed) return { rowCount: 0, rows: [] };
        consumed = true;
        return { rowCount: 1, rows: [{}] };
      }
      if (!consumed) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ used_at: NOW, expires_at: new Date(NOW.getTime() + 60_000) }] };
    },
  };
  return jar as unknown as Db & { queries: number };
}

function chainOf(kind: 'mock' | 'near', permission: 'FullAccess' | 'FunctionCall' | null = 'FullAccess') {
  const chain = {
    kind,
    calls: 0,
    async keyPermission(): Promise<'FullAccess' | 'FunctionCall' | null> {
      chain.calls += 1;
      return permission;
    },
  };
  return chain;
}

function signedLogin(accountId = 'alice.testnet', recipient = RECIPIENT): NearLoginBody {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const nonce = crypto.randomBytes(32).toString('base64');
  const signature = signNep413(privateKey, loginMessage(accountId, nonce), Buffer.from(nonce, 'base64'), recipient);
  return { accountId, publicKey: encodePublicKey(rawPublicKey(publicKey)), signature, nonce };
}

function nearDeps(network: 'testnet' | 'mainnet' | 'sandbox', chain: ReturnType<typeof chainOf>, db: Db): NearLoginDeps {
  return { config: { intake: { network, recipient: RECIPIENT } }, chain, db, now: NOW };
}

test('social account id is stable, fits an account id, and differs for google and x', () => {
  const google = socialAccountId('google', 'google-oauth2|12345');
  assert.equal(google, socialAccountId('google', 'google-oauth2|12345'));
  const x = socialAccountId('x', 'twitter|12345');
  assert.notEqual(google, x);
  assert.notEqual(socialAccountId('google', 'google-oauth2|12345'), socialAccountId('x', 'google-oauth2|12345'));
  assert.match(google, ACCOUNT_ID);
  assert.match(x, ACCOUNT_ID);
  assert.match(google, /^g\.[0-9a-f]{40}$/);
  assert.match(x, /^x\.[0-9a-f]{40}$/);
});

test('a redirect URI with the wrong path, a query, credentials or a fragment is refused before any fetch', async () => {
  const fetchImpl = (async () => {
    throw new Error('fetch must not run');
  }) as typeof fetch;
  const bad = [
    'https://example.com/login',
    'https://example.com/auth/callback?next=/',
    'https://user:pass@example.com/auth/callback',
    'https://example.com/auth/callback#frag',
    'http://example.com/auth/callback/',
    'ftp://example.com/auth/callback',
  ];
  for (const redirectUri of bad) {
    const error = await rejected(() => loginSocial(
      { provider: 'google', token: fastAuthToken('code', 'verifier', redirectUri) },
      fetchImpl,
    ));
    assert.equal(error.code, 'UNAUTHORIZED', redirectUri);
    assert.equal(error.message, 'Sign in failed');
  }
  const incomplete = await rejected(() => loginSocial({ provider: 'google', token: 'not-a-pkce-token' }, fetchImpl));
  assert.equal(incomplete.code, 'UNAUTHORIZED');
});

test('PKCE exchange verifies a locally signed id_token and derives the session', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256' };
  const subject = 'google-oauth2|12345';
  const email = `${'ada'.repeat(80)}@example.com`;
  const idToken = rs256(privateKey, idClaims(subject, email), 'test-kid');
  const seen: SeenFetch = { urls: [] };
  const session = await loginSocial(
    { provider: 'google', token: fastAuthToken('auth-code', 'verifier-value', REDIRECT) },
    pkceFetch(idToken, jwk, seen),
  );
  assert.deepEqual(seen.urls, [`${ISSUER}oauth/token`, `${ISSUER}.well-known/jwks.json`]);
  assert.deepEqual(seen.body, {
    grant_type: 'authorization_code', client_id: CLIENT_ID, code: 'auth-code', code_verifier: 'verifier-value', redirect_uri: REDIRECT,
  });
  assert.equal(session.account, socialAccountId('google', subject));
  assert.match(session.account, ACCOUNT_ID);
  assert.equal(session.provider, 'google');
  assert.equal(session.label.length, 128);
  assert.equal(session.label, email.slice(0, 128));

  const xSeen: SeenFetch = { urls: [] };
  const xSubject = 'twitter|999';
  const xToken = rs256(privateKey, idClaims(xSubject), 'test-kid');
  const xSession = await loginSocial({ provider: 'x', token: fastAuthToken('c2', 'v2', REDIRECT) }, pkceFetch(xToken, jwk, xSeen));
  assert.equal(xSession.account, socialAccountId('x', xSubject));
  assert.match(xSession.account, ACCOUNT_ID);
  assert.notEqual(xSession.account, session.account);
  assert.equal(xSession.label, 'X');
  assert.equal(xSession.provider, 'x');

  const mismatch = await rejected(() => loginSocial(
    { provider: 'x', token: fastAuthToken('c3', 'v3', REDIRECT) },
    pkceFetch(idToken, jwk, { urls: [] }),
  ));
  assert.equal(mismatch.code, 'UNAUTHORIZED');
  assert.equal(mismatch.message, 'Sign in failed');

  const flipped = `${idToken.slice(0, -4)}AAAA`;
  const tampered = await rejected(() => loginSocial(
    { provider: 'google', token: fastAuthToken('c4', 'v4', REDIRECT) },
    pkceFetch(flipped, jwk, { urls: [] }),
  ));
  assert.equal(tampered.code, 'UNAUTHORIZED');
});

test('the login message is the exact JSON object, and verifyNep413 checks that signature', () => {
  const nonce = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const message = loginMessage('alice.testnet', nonce);
  assert.equal(message, '{"account":"alice.testnet","kind":"login","nonce":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=","v":1}');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const nonceBytes = Buffer.from(nonce, 'base64');
  const signature = Buffer.from(signNep413(privateKey, message, nonceBytes, RECIPIENT), 'base64');
  const raw = rawPublicKey(publicKey);
  assert.equal(verifyNep413(raw, signature, message, nonceBytes, RECIPIENT), true);
  assert.equal(verifyNep413(raw, signature, loginMessage('bob.testnet', nonce), nonceBytes, RECIPIENT), false);
});

test('NEAR login accepts that signature, skips the chain on sandbox and mock, and requires FullAccess on testnet', async () => {
  const sandbox = chainOf('near');
  const sandboxDb = nonceJar();
  const first = signedLogin();
  const session = await loginNear(nearDeps('sandbox', sandbox, sandboxDb), first);
  assert.deepEqual(session, { account: 'alice.testnet', label: 'alice.testnet', provider: 'near' });
  assert.equal(sandbox.calls, 0, 'sandbox must not ask the RPC');
  assert.equal(sandboxDb.queries, 1);
  const reused = await rejected(() => loginNear(nearDeps('sandbox', sandbox, sandboxDb), first));
  assert.equal(reused.code, 'NONCE_USED');

  const mock = chainOf('mock');
  const mockSession = await loginNear(nearDeps('testnet', mock, nonceJar()), signedLogin());
  assert.equal(mockSession.provider, 'near');
  assert.equal(mock.calls, 0, 'the mock adapter has no testnet keys to check');

  const limited = chainOf('near', 'FunctionCall');
  const limitedDb = nonceJar();
  const denied = await rejected(() => loginNear(nearDeps('testnet', limited, limitedDb), signedLogin()));
  assert.equal(denied.code, 'KEY_NOT_FULL_ACCESS');
  assert.equal(limited.calls, 1);
  assert.equal(limitedDb.queries, 0, 'a rejected key does not consume the nonce');

  const mainnet = chainOf('near', 'FunctionCall');
  const mainnetDenied = await rejected(() => loginNear(nearDeps('mainnet', mainnet, nonceJar()), signedLogin()));
  assert.equal(mainnetDenied.code, 'KEY_NOT_FULL_ACCESS');
  assert.equal(mainnet.calls, 1);

  const allowed = chainOf('near', 'FullAccess');
  const allowedSession = await loginNear(nearDeps('testnet', allowed, nonceJar()), signedLogin());
  assert.equal(allowedSession.account, 'alice.testnet');
  assert.equal(allowed.calls, 1);

  const tampered = signedLogin();
  const tamperedDb = nonceJar();
  const bad = await rejected(() => loginNear(nearDeps('sandbox', chainOf('near'), tamperedDb), { ...tampered, accountId: 'bob.testnet' }));
  assert.equal(bad.code, 'SIG_INVALID');
  assert.equal(tamperedDb.queries, 0);

  const unknown = await rejected(() => loginNear(
    nearDeps('sandbox', chainOf('near'), { async query() { return { rowCount: 0, rows: [] }; } } as unknown as Db),
    signedLogin(),
  ));
  assert.equal(unknown.code, 'NONCE_UNKNOWN');
});

function cookiePair(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.equal(typeof header, 'string');
  const pair = String(header).split(';')[0];
  assert.ok(pair && pair.startsWith('sid='));
  return pair;
}

async function appWith(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  installErrorHandling(app);
  await app.register(cookie, { secret: 's'.repeat(32) });
  await app.register(authRoutes, { deps });
  await app.register(dashboardRoutes, { deps });
  return app;
}

test('password, social and near routes set a sid cookie; an old {a, e} cookie still reads', async () => {
  const jar = nonceJar();
  const chain = chainOf('near');
  const deps = {
    config: {
      env: 'test',
      dashboard: { login: null, password: null },
      http: { rateLimitPerMinute: 60, cookieSecure: false },
      intake: { network: 'sandbox', recipient: RECIPIENT },
    },
    clock: { now: () => NOW },
    pool: jar,
    chain,
  } as unknown as ApiDeps;
  const app = await appWith(deps);
  try {
    const wrong = await app.inject({
      method: 'POST', url: '/api/login', headers: { 'content-type': 'application/json' },
      payload: { login: 'operator', password: 'nope' },
    });
    assert.equal(wrong.statusCode, 401);
    const loggedIn = await app.inject({
      method: 'POST', url: '/api/login', headers: { 'content-type': 'application/json' },
      payload: { login: 'operator', password: 'operator' },
    });
    assert.equal(loggedIn.statusCode, 200);
    assert.deepEqual(loggedIn.json(), { account: 'operator' });
    const session = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: cookiePair(loggedIn.headers['set-cookie']) } });
    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json(), { account: 'operator', provider: 'password' });

    const oldValue = Buffer.from(JSON.stringify({ a: 'bob.testnet', e: NOW.getTime() + 60_000 })).toString('base64url');
    const old = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: `sid=${app.signCookie(oldValue)}` } });
    assert.deepEqual(old.json(), { account: 'bob.testnet' });
    const anon = await app.inject({ method: 'GET', url: '/api/session' });
    assert.equal(anon.statusCode, 401);

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256' };
    const subject = 'google-oauth2|route';
    const previous = globalThis.fetch;
    globalThis.fetch = pkceFetch(rs256(privateKey, idClaims(subject, 'ada@example.com'), 'test-kid'), jwk, { urls: [] });
    try {
      const social = await app.inject({
        method: 'POST', url: '/api/login/social', headers: { 'content-type': 'application/json' },
        payload: { provider: 'google' satisfies SocialProvider, token: fastAuthToken('route-code', 'route-verifier', REDIRECT) },
      });
      assert.equal(social.statusCode, 200, social.body);
      assert.deepEqual(social.json(), {
        account: socialAccountId('google', subject), label: 'ada@example.com', provider: 'google',
      });
      assert.match(String(social.headers['set-cookie']), /HttpOnly/i);
      const again = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: cookiePair(social.headers['set-cookie']) } });
      assert.deepEqual(again.json(), social.json());
    } finally {
      globalThis.fetch = previous;
    }

    const nearBody = signedLogin();
    const near = await app.inject({
      method: 'POST', url: '/api/login/near', headers: { 'content-type': 'application/json' }, payload: nearBody,
    });
    assert.equal(near.statusCode, 200, near.body);
    assert.deepEqual(near.json(), { account: 'alice.testnet', label: 'alice.testnet', provider: 'near' });
    assert.equal(chain.calls, 0);
    const replay = await app.inject({
      method: 'POST', url: '/api/login/near', headers: { 'content-type': 'application/json' }, payload: nearBody,
    });
    assert.equal(replay.statusCode, 409);
    assert.equal(replay.json().error.code, 'NONCE_USED');
  } finally {
    await app.close();
  }
});

test('setSession keeps a long label to 128 characters and requireAccount still returns the account', async () => {
  const app = Fastify();
  await app.register(cookie, { secret: 's'.repeat(32) });
  installErrorHandling(app);
  const label = 'L'.repeat(200);
  app.post('/set', async (_request, reply) => {
    setSession(reply, 'operator', NOW, false, { label, provider: 'password' });
    return { ok: true };
  });
  app.get('/read', async (request) => {
    const session = readSession(request, NOW);
    if (!session) fail('UNAUTHORIZED', 'Sign in required');
    return { session, account: requireAccount(request, NOW) };
  });
  const set = await app.inject({ method: 'POST', url: '/set' });
  const read = await app.inject({ method: 'GET', url: '/read', headers: { cookie: cookiePair(set.headers['set-cookie']) } });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().session.label, 'L'.repeat(128));
  assert.equal(read.json().account, 'operator');
  const forged = await app.inject({ method: 'GET', url: '/read', headers: { cookie: 'sid=not-signed' } });
  assert.equal(forged.statusCode, 401);
  await app.close();
});
