// W08 wave check (@hack): demo steps 1-8 against the real processes (`db:migrate`, the API server,
// the dev scripts) on a throwaway database with the mock chain and recorded GitHub. Skips without
// DATABASE_URL (a server where it may create and drop a database).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { call, conforms, sessionCookie } from '../../../apps/api/test/helpers/flow.ts';
import { freshDatabase, NEEDS_DB, type TestDatabase } from '../../../apps/api/test/helpers/db.ts';
import { SHA, testEnv } from '../../../apps/api/test/helpers/stack.ts';
import { freePort, Proc, script, step, waitFor } from './processes.ts';

describe('W08 intake API @hack', NEEDS_DB, () => {
  let db: TestDatabase;
  let env: Record<string, string>;
  let api: Proc;
  let base = '';
  let pool: pg.Pool;
  before(async () => {
    db = await freshDatabase('w08');
    const port = await freePort();
    env = testEnv(db.url, { PORT: String(port), ADMIN_PORT: String(await freePort()), RATE_LIMIT_PER_MINUTE: '30' });
    const migrated = script('src/bin/migrate.ts', [], env);
    assert.equal(migrated.status, 0, migrated.stderr);
    api = new Proc('src/bin/api.ts', env);
    base = `http://127.0.0.1:${port}`;
    await waitFor(async () => (await fetch(`${base}/api/ready`)).ok);
    pool = new pg.Pool({ connectionString: db.url, max: 2 });
    process.stdout.write(`# W08 API on port ${port}\n`);
  });
  after(async () => {
    await pool?.end();
    assert.equal(await api?.stop(), 0, 'SIGTERM drains and exits 0');
    await db?.drop();
  });

  const challenge = async () => (await call(base, '/api/challenge', { method: 'POST', body: {} })).body.nonce as string;
  const signed = (nonce: string, account = 'alice.mock', extra: string[] = []) => {
    const run = script('scripts/sign-request.ts', ['--account', account, '--nonce', nonce, '--commit', SHA, ...extra], env);
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  const mockPay = (requestId: string, extra: string[] = []) => {
    const run = script('scripts/mock-pay.ts', [requestId, ...extra], env);
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout).txHash as string;
  };
  let created: { requestId: string; cookie: string };

  test('1: health, readiness and the OpenAPI docs', async () => {
    step(1, 'GET /api/health, /api/ready, /api/docs');
    const health = await call(base, '/api/health');
    conforms('health-response', health.body);
    assert.equal(health.body.network, 'testnet');
    assert.equal((await call(base, '/api/ready')).status, 200);
    const docs = await fetch(`${base}/api/docs/`);
    assert.equal(docs.status, 200);
    assert.match(await docs.text(), /swagger/i);
  });

  test('3: quote and the GitHub rejections', async () => {
    step(3, 'POST /api/quote');
    const quote = await call(base, '/api/quote', { method: 'POST', body: { repoUrl: 'https://github.com/near/near-sdk-rs', network: 'testnet' } });
    conforms('quote-response', quote.body);
    assert.equal(quote.body.commitSha, SHA);
    assert.equal(quote.body.queueDepth, 0);
    for (const [repo, code] of [['private/hidden', 'REPO_PRIVATE'], ['archived/old', 'REPO_ARCHIVED'], ['huge/repo', 'REPO_TOO_LARGE']]) {
      assert.equal((await call(base, '/api/quote', { method: 'POST', body: { repoUrl: `https://github.com/${repo}`, network: 'testnet' } })).body.error.code, code);
    }
  });

  test('4-5: a signed request, then replay, tamper, function-call key and expiry are refused', async () => {
    step(4, 'sign-request.ts + POST /api/requests');
    const nonce = await challenge();
    assert.equal(nonce.length, 44);
    const body = signed(nonce);
    const reply = await call(base, '/api/requests', { method: 'POST', body });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
    created = { requestId: reply.body.requestId, cookie: sessionCookie(reply) };
    step(5, 'replay, tamper, FunctionCall key, expired nonce');
    assert.equal((await call(base, '/api/requests', { method: 'POST', body })).body.error.code, 'NONCE_USED');
    const tampered = signed(await challenge());
    tampered.message = tampered.message.replace('near-sdk-rs', 'near-sdk-rx');
    assert.equal((await call(base, '/api/requests', { method: 'POST', body: tampered })).body.error.code, 'SIG_INVALID');
    const fnKey = signed(await challenge(), 'bob.mock', ['--permission', 'FunctionCall']);
    assert.equal((await call(base, '/api/requests', { method: 'POST', body: fnKey })).body.error.code, 'KEY_NOT_FULL_ACCESS');
    const late = signed(await challenge(), 'carol.mock');
    await pool.query(`UPDATE nonce SET expires_at = now() - interval '1 second' WHERE nonce = $1`, [late.nonce]);
    assert.equal((await call(base, '/api/requests', { method: 'POST', body: late })).body.error.code, 'NONCE_EXPIRED');
  });

  test('6-7: payment queues the request; reused, underpaid and foreign payments are refused; reads', async () => {
    step(6, 'mock-pay.ts + POST /api/requests/:id/payment');
    const txHash = mockPay(created.requestId);
    const paid = await call(base, `/api/requests/${created.requestId}/payment`, { method: 'POST', body: { txHash }, cookie: created.cookie });
    assert.deepEqual(paid.body, { status: 'queued', position: 1 });
    const replay = await call(base, `/api/requests/${created.requestId}/payment`, { method: 'POST', body: { txHash }, cookie: created.cookie });
    assert.deepEqual(replay.body, { status: 'queued', position: 1 }, 'a replay answers with the current status and rank');
    const other = await call(base, '/api/requests', { method: 'POST', body: signed(await challenge(), 'dave.mock') });
    const otherCookie = sessionCookie(other);
    const reused = await call(base, `/api/requests/${other.body.requestId}/payment`, { method: 'POST', body: { txHash }, cookie: otherCookie });
    assert.equal(reused.body.error.code, 'TX_ALREADY_USED');
    const foreign = mockPay(other.body.requestId, ['--signer', 'mallory.mock']);
    assert.equal((await call(base, `/api/requests/${other.body.requestId}/payment`, { method: 'POST', body: { txHash: foreign }, cookie: otherCookie })).status, 403);
    const third = await call(base, '/api/requests', { method: 'POST', body: signed(await challenge(), 'erin.mock') });
    const under = mockPay(third.body.requestId, ['--amount', '1']);
    assert.equal((await call(base, `/api/requests/${third.body.requestId}/payment`, { method: 'POST', body: { txHash: under }, cookie: sessionCookie(third) })).status, 402);
    step(7, 'GET /api/requests/:id and ?mine=1');
    const view = await call(base, `/api/requests/${created.requestId}`);
    conforms('request-status-response', view.body);
    assert.equal(view.body.status, 'queued');
    assert.equal((await call(base, '/api/requests?mine=1', { cookie: created.cookie })).body.requests.length, 1);
    assert.equal((await call(base, '/api/requests?mine=1')).status, 401);
    const events = await pool.query(`SELECT DISTINCT event FROM audit_log`);
    for (const event of ['challenge_issued', 'request_created', 'payment_verified']) assert.ok(events.rows.some((row) => row.event === event), event);
  });

  test('8: the reconciler queues a request whose client paid but never confirmed', async () => {
    step(8, 'reconcile.ts');
    const parked = await call(base, '/api/requests', { method: 'POST', body: signed(await challenge(), 'frank.mock') });
    mockPay(parked.body.requestId);
    const run = script('scripts/reconcile.ts', [], env);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(JSON.parse(run.stdout).queued.includes(parked.body.requestId));
    assert.equal((await call(base, `/api/requests/${parked.body.requestId}`)).body.status, 'queued');
  });

  test('2: the 31st challenge in a minute from one IP is 429 RATE_LIMITED', async () => {
    step(2, '31 x POST /api/challenge');
    await pool.query('DELETE FROM rate_limit');
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await call(base, '/api/challenge', { method: 'POST', body: {} })).status);
    assert.equal(statuses.filter((status) => status === 200).length, 30);
    assert.equal(statuses.at(-1), 429);
  });
});
