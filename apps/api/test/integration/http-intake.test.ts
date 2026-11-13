// The HTTP API over real HTTP on a fresh database: health, challenge, NEAR sign-in (and every rejection),
// sessions, dashboard job creation, reads and error shapes. Responses are checked against
// packages/schemas/intake-api.schema.json.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DevWallet } from '../../scripts/dev-wallet.ts';
import { MockAccountKeyVerifier } from '../../src/near/mock-key-verifier.ts';
import { call, challenge, conforms, freshAccount, queuedJob, saveKey, sessionCookie, signIn } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { RECIPIENT, TestClock, migratedDb, startApi, type ApiStack, type TestDb } from '../helpers/stack.ts';

describe('HTTP API', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  const clock = new TestClock();
  before(async () => {
    t = await migratedDb('http');
    api = await startApi(t.env, clock);
  });
  after(async () => {
    await api?.close();
    await t?.db.drop();
  });

  test('health, readiness and docs: no chain, no network, no payment routes', async () => {
    const health = await call(api.base, '/api/health');
    assert.equal(health.status, 200);
    conforms('health-response', health.body);
    assert.deepEqual(Object.keys(health.body).sort(), ['ok', 'queueDepth', 'workers']);
    const ready = await call(api.base, '/api/ready');
    assert.equal(ready.status, 200);
    conforms('ready-response', ready.body);
    const docs = await call(api.base, '/api/docs/json');
    assert.equal(docs.status, 200);
    for (const path of ['/api/challenge', '/api/login/near', '/api/dashboard/jobs', '/api/requests/{id}', '/api/requests/{id}/events', '/api/reports/{id}']) {
      assert.ok(docs.body.paths[path], `OpenAPI lists ${path}`);
    }
    for (const gone of ['/api/quote', '/api/requests/{id}/payment', '/api/ledger', '/api/guard/verdict', '/api/free/jobs', '/api/review-settings']) {
      assert.ok(!docs.body.paths[gone], `${gone} is gone`);
    }
    for (const [path, method] of [['/api/quote', 'POST'], ['/api/requests', 'POST'], ['/api/ledger', 'GET'], ['/api/guard/verdict', 'GET']] as const) {
      assert.equal((await call(api.base, path, { method, body: method === 'POST' ? {} : undefined })).status, 404, path);
    }
  });

  test('challenge nonces are 44-char base64 and expire in five minutes', async () => {
    const first = await call(api.base, '/api/challenge', { method: 'POST', body: {} });
    const second = await call(api.base, '/api/challenge', { method: 'POST' });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.notEqual(first.body.nonce, second.body.nonce);
    assert.equal(first.body.nonce.length, 44);
    const row = await api.deps.pool.query('SELECT expires_at - created_at AS ttl FROM nonce WHERE nonce = $1', [first.body.nonce]);
    assert.equal(row.rows[0].ttl.minutes, 5);
  });

  test('NEAR sign-in sets an httpOnly session, once per challenge', async () => {
    const dev = new DevWallet(freshAccount());
    const body = dev.login(await challenge(api.base), RECIPIENT);
    const reply = await call(api.base, '/api/login/near', { method: 'POST', body });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.match(reply.headers.get('set-cookie') ?? '', /sid=.*HttpOnly.*SameSite=Lax/i);
    assert.deepEqual(reply.body, { account: dev.accountId, label: dev.accountId, provider: 'near' });
    const session = await call(api.base, '/api/session', { cookie: sessionCookie(reply) });
    assert.equal(session.body.account, dev.accountId);
    const replay = await call(api.base, '/api/login/near', { method: 'POST', body });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error.code, 'NONCE_USED');
  });

  test('sign-in rejections: signature, recipient, key permission, nonce', async () => {
    const dev = new DevWallet(freshAccount());
    const login = async (patch: Record<string, unknown> = {}, recipient = RECIPIENT, wallet = dev) => (
      call(api.base, '/api/login/near', { method: 'POST', body: { ...wallet.login(await challenge(api.base), recipient), ...patch } }));
    const other = dev.login(await challenge(api.base), RECIPIENT);
    let reply = await login({ signature: other.signature });
    assert.equal(reply.status, 401);
    assert.equal(reply.body.error.code, 'SIG_INVALID');
    reply = await login({}, 'evil.near');
    assert.equal(reply.body.error.code, 'SIG_INVALID', 'a signature for another recipient is refused');
    reply = await login({ accountId: 'mallory.near' });
    assert.equal(reply.body.error.code, 'SIG_INVALID', 'the login message names the account');
    const verifier = api.deps.keys as MockAccountKeyVerifier;
    const limited = new DevWallet(freshAccount());
    verifier.register(limited.accountId, limited.publicKey, 'FunctionCall');
    reply = await login({}, RECIPIENT, limited);
    assert.equal(reply.body.error.code, 'KEY_NOT_FULL_ACCESS');
    const stranger = new DevWallet(freshAccount());
    verifier.register(stranger.accountId, stranger.publicKey, null);
    reply = await login({}, RECIPIENT, stranger);
    assert.equal(reply.body.error.code, 'KEY_NOT_FULL_ACCESS');
    const expiring = dev.login(await challenge(api.base), RECIPIENT);
    clock.advance(6 * 60_000);
    reply = await call(api.base, '/api/login/near', { method: 'POST', body: expiring });
    clock.advance(-6 * 60_000);
    assert.equal(reply.body.error.code, 'NONCE_EXPIRED');
    reply = await call(api.base, '/api/login/near', { method: 'POST', body: dev.login(Buffer.alloc(32, 7).toString('base64'), RECIPIENT) });
    assert.equal(reply.body.error.code, 'NONCE_UNKNOWN');
    const all = await api.deps.pool.query(`SELECT data::text AS data FROM audit_log`);
    for (const row of all.rows) assert.ok(!row.data.includes(other.signature), 'no signature in audit_log');
  });

  test('a dashboard job needs a sign-in and a saved key, then is queued with its job in one step', async () => {
    assert.equal((await call(api.base, '/api/dashboard/jobs', { method: 'POST', body: { repo: 'near/near-sdk-rs' } })).status, 401);
    const { cookie } = await signIn(api.base);
    const refused = await call(api.base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo: 'near/near-sdk-rs' } });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, 'PRESET_NOT_ALLOWED');
    await saveKey(api.base, cookie);
    const created = await call(api.base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo: 'https://github.com/near/near-sdk-rs/tree/master' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(Object.keys(created.body).sort(), ['commitSha', 'repo', 'requestId', 'status']);
    const view = await call(api.base, `/api/requests/${created.body.requestId}`);
    conforms('request-status-response', view.body);
    assert.equal(view.body.status, 'queued');
    assert.equal(view.body.position, 1);
    assert.deepEqual(view.body.timeline.map((event: { event: string }) => event.event), ['request_created']);
    const jobs = await api.deps.pool.query(`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'review' AND singleton_key = $1`, [created.body.requestId]);
    assert.equal(jobs.rows[0].n, 1);
    const again = await call(api.base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo: 'near/near-sdk-rs' } });
    assert.equal(again.status, 429, 'one review in progress per account');
    assert.equal(again.body.error.code, 'RATE_LIMITED');
    await api.deps.boss.deleteAllJobs('review');
  });

  test('GitHub rejections map to their codes', async () => {
    const { cookie } = await signIn(api.base);
    await saveKey(api.base, cookie);
    for (const [repo, code, status] of [
      ['private/hidden', 'REPO_PRIVATE', 400], ['archived/old', 'REPO_ARCHIVED', 400], ['huge/repo', 'REPO_TOO_LARGE', 400],
      ['torvalds/linux', 'REPO_NOT_FOUND', 404], ['near/near-sdk-rs/tree/nope', 'REF_NOT_FOUND', 404], ['git@github.com:near/near-sdk-rs', 'REPO_INVALID', 400],
    ] as const) {
      const reply = await call(api.base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo } });
      assert.equal(reply.body.error?.code, code, repo);
      assert.equal(reply.status, status, repo);
      conforms('error-response', reply.body);
    }
  });

  test('reads, sessions and error shapes', async () => {
    const job = await queuedJob(api.base);
    const mine = await call(api.base, '/api/requests?mine=1', { cookie: job.cookie });
    conforms('request-list-response', mine.body);
    assert.deepEqual(mine.body.requests.map((row: { requestId: string }) => row.requestId), [job.requestId]);
    const other = await signIn(api.base);
    const theirs = await call(api.base, '/api/requests?mine=1', { cookie: other.cookie });
    assert.deepEqual(theirs.body.requests, []);
    const [name, value] = job.cookie.split('=') as [string, string];
    const forged = await call(api.base, '/api/requests?mine=1', { cookie: `${name}=${value.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))}` });
    assert.equal(forged.status, 401);
    assert.equal((await call(api.base, '/api/requests?mine=1')).status, 401);
    const missing = await call(api.base, '/api/requests/3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'REQUEST_NOT_FOUND');
    const badId = await call(api.base, '/api/requests/not-a-uuid');
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error.code, 'VALIDATION_ERROR');
    const unknown = await call(api.base, '/api/nope');
    assert.equal(unknown.status, 404);
    conforms('error-response', unknown.body);
    const big = await call(api.base, '/api/dashboard/jobs', { method: 'POST', cookie: job.cookie, body: { repo: 'x'.repeat(20 * 1024) } });
    assert.equal(big.status, 413);
    conforms('error-response', big.body);
    const notDone = await call(api.base, `/api/reports/${job.requestId}`);
    assert.equal(notDone.status, 404, 'a request without a published report has no index');
    await api.deps.boss.deleteAllJobs('review');
  });

  test('security headers are set and no CORS is granted without LANDING_ORIGIN', async () => {
    const reply = await call(api.base, '/api/health', { headers: { origin: 'https://evil.example' } });
    assert.equal(reply.headers.get('access-control-allow-origin'), null);
    assert.equal(reply.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(reply.headers.get('content-security-policy'));
  });
});
