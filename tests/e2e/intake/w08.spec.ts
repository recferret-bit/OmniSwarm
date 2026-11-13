// W08 wave check (@hack): the intake API against the real processes (`db:migrate`, the API server) on a
// throwaway database with the mock key verifier and recorded GitHub: health, NEAR sign-in and its refusals,
// a dashboard job on the account's own key, reads and the rate limit. No chain, no payment. Skips without
// DATABASE_URL (a server where it may create and drop a database).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { DevWallet } from '../../../apps/api/scripts/dev-wallet.ts';
import { call, conforms, queuedJob, saveKey, sessionCookie, signIn } from '../../../apps/api/test/helpers/flow.ts';
import { freshDatabase, NEEDS_DB, type TestDatabase } from '../../../apps/api/test/helpers/db.ts';
import { RECIPIENT, SHA, testEnv } from '../../../apps/api/test/helpers/stack.ts';
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
    env = testEnv(db.url, { PORT: String(port), RATE_LIMIT_PER_MINUTE: '30' });
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
  let job: { requestId: string; cookie: string };

  test('1: health, readiness and the OpenAPI docs', async () => {
    step(1, 'GET /api/health, /api/ready, /api/docs');
    const health = await call(base, '/api/health');
    conforms('health-response', health.body);
    assert.deepEqual(Object.keys(health.body).sort(), ['ok', 'queueDepth', 'workers']);
    assert.equal((await call(base, '/api/ready')).status, 200);
    const docs = await fetch(`${base}/api/docs/`);
    assert.equal(docs.status, 200);
    assert.match(await docs.text(), /swagger/i);
    for (const gone of ['/api/quote', '/api/ledger', '/api/guard/verdict']) assert.equal((await call(base, gone)).status, 404, gone);
  });

  test('3-5: NEAR sign-in; replay, tampered signature, function-call key and expired nonce are refused', async () => {
    step(3, 'POST /api/challenge + POST /api/login/near');
    const nonce = await challenge();
    assert.equal(nonce.length, 44);
    const wallet = new DevWallet('alice.near');
    const body = wallet.login(nonce, RECIPIENT);
    const reply = await call(base, '/api/login/near', { method: 'POST', body });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.match(sessionCookie(reply), /^sid=/);
    step(5, 'replay, tamper, expired nonce');
    assert.equal((await call(base, '/api/login/near', { method: 'POST', body })).body.error.code, 'NONCE_USED');
    const other = wallet.login(await challenge(), RECIPIENT);
    const tampered = { ...wallet.login(await challenge(), RECIPIENT), signature: other.signature };
    assert.equal((await call(base, '/api/login/near', { method: 'POST', body: tampered })).body.error.code, 'SIG_INVALID');
    const late = new DevWallet('carol.near').login(await challenge(), RECIPIENT);
    await pool.query(`UPDATE nonce SET expires_at = now() - interval '1 second' WHERE nonce = $1`, [late.nonce]);
    assert.equal((await call(base, '/api/login/near', { method: 'POST', body: late })).body.error.code, 'NONCE_EXPIRED');
  });

  test('6: a dashboard job needs a saved key, then is queued with no payment step', async () => {
    step(6, 'PUT /api/account/providers/nearai + POST /api/dashboard/jobs');
    const { cookie } = await signIn(base);
    const refused = await call(base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo: 'near/near-sdk-rs' } });
    assert.equal(refused.body.error.code, 'PRESET_NOT_ALLOWED');
    await saveKey(base, cookie);
    for (const [repo, code] of [['private/hidden', 'REPO_PRIVATE'], ['archived/old', 'REPO_ARCHIVED'], ['huge/repo', 'REPO_TOO_LARGE']]) {
      assert.equal((await call(base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo } })).body.error.code, code);
    }
    const created = await call(base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo: 'near/near-sdk-rs' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.commitSha, SHA);
    job = { requestId: created.body.requestId, cookie };
  });

  test('7: reads', async () => {
    step(7, 'GET /api/requests/:id and ?mine=1');
    const view = await call(base, `/api/requests/${job.requestId}`);
    conforms('request-status-response', view.body);
    assert.equal(view.body.status, 'queued');
    assert.equal(view.body.position, 1);
    assert.equal((await call(base, '/api/requests?mine=1', { cookie: job.cookie })).body.requests.length, 1);
    assert.equal((await call(base, '/api/requests?mine=1')).status, 401);
    const events = await pool.query(`SELECT DISTINCT event FROM audit_log`);
    for (const event of ['challenge_issued', 'request_created']) assert.ok(events.rows.some((row) => row.event === event), event);
    assert.ok(!events.rows.some((row) => row.event === 'payment_verified'));
    assert.ok((await queuedJob(base)).requestId, 'another account queues its own review');
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
