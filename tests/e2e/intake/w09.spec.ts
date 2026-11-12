// W09 wave check (@hack): demo steps 1, 2, 3, 5, 6 (SIGKILL and SIGTERM), 7, 8, 9 with real API and worker processes, the mock
// engine and the mock chain. Every terminal path ends with at most one attestation or refund, and a
// provider key planted in the worker env appears nowhere in Postgres, logs or the published report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { chainEvents } from '../../../apps/api/src/chain/mock/mock-ledger.ts';
import { call, conforms, queuedRequest } from '../../../apps/api/test/helpers/flow.ts';
import { freshDatabase, NEEDS_DB, type TestDatabase } from '../../../apps/api/test/helpers/db.ts';
import { ADMIN_TOKEN, testEnv } from '../../../apps/api/test/helpers/stack.ts';
import { freePort, Proc, script, step, waitFor } from './processes.ts';

const PLANTED_KEY = 'near-planted-0123456789abcdef';

function streamEvents(url: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const events: any[] = [];
    http.get(url, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        for (let cut = buffer.indexOf('\n\n'); cut >= 0; cut = buffer.indexOf('\n\n')) {
          const data = buffer.slice(0, cut).split('\n').find((line) => line.startsWith('data: '));
          buffer = buffer.slice(cut + 2);
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      });
      res.on('end', () => resolve(events));
    }).on('error', reject);
  });
}

describe('W09 queue and worker @hack', NEEDS_DB, () => {
  let db: TestDatabase;
  let env: Record<string, string>;
  let api: Proc;
  let base = '';
  let adminBase = '';
  let pool: pg.Pool;
  const workers: Proc[] = [];
  const worker = (extra: Record<string, string> = {}) => {
    const proc = new Proc('src/bin/worker.ts', { ...env, NEARAI_API_KEY: PLANTED_KEY, ...extra });
    workers.push(proc);
    return proc;
  };
  const status = async (id: string) => (await pool.query('SELECT * FROM request WHERE id = $1', [id])).rows[0];
  const until = (id: string, wanted: string[]) => waitFor(async () => {
    const row = await status(id);
    return wanted.includes(row?.status) ? row : null;
  }, 60_000);
  const attests = async (hash: string) => (await chainEvents(pool, hash)).filter((e) => e === 'review_attested').length;
  const refunds = async (hash: string) => (await chainEvents(pool, hash)).filter((e) => e === 'review_refunded').length;

  before(async () => {
    db = await freshDatabase('w09');
    const port = await freePort();
    const adminPort = await freePort();
    env = testEnv(db.url, { PORT: String(port), ADMIN_PORT: String(adminPort), LOG_LEVEL: 'info' });
    assert.equal(script('src/bin/migrate.ts', [], env).status, 0);
    api = new Proc('src/bin/api.ts', env);
    base = `http://127.0.0.1:${port}`;
    adminBase = `http://127.0.0.1:${adminPort}`;
    await waitFor(async () => (await fetch(`${base}/api/ready`)).ok);
    pool = new pg.Pool({ connectionString: db.url, max: 3 });
    process.stdout.write(`# W09 API on port ${port}, admin on 127.0.0.1:${adminPort}, workers use the mock engine\n`);
  });
  after(async () => {
    for (const proc of workers) await proc.stop();
    await pool?.end();
    await api?.stop();
    await db?.drop();
  });

  test('1-3: a queued request streams progress over SSE, is published, attested once, and the hash recomputes', async () => {
    const request = await queuedRequest(base, pool);
    step(1, 'worker + GET /api/requests/:id/events');
    const events = streamEvents(`${base}/api/requests/${request.requestId}/events`);
    const proc = worker({ MOCK_ENGINE_STEP_MS: '200' });
    const seen = await events;
    for (const event of seen) conforms('progress-event', event);
    const percents = seen.filter((e) => e.progress).map((e) => e.progress.percent);
    assert.ok(percents.length >= 5, `${percents}`);
    assert.ok(seen.some((e) => e.progress?.phase === 'review' && e.progress.reviewer === 'scripted-baseline'));
    assert.equal(seen.at(-1).status, 'done');
    step(2, 'done: reportUrl, reportSha256, attestTx, review_attested');
    const view = (await call(base, `/api/requests/${request.requestId}`)).body;
    assert.equal(view.reportUrl, `https://reports.test/${request.requestId}/report.html`);
    assert.ok(view.attestTx);
    assert.equal(await attests(request.requestHash), 1);
    step(3, 'report-hash.ts recomputes the attested hash');
    const dir = path.join(env.REPORTS_ROOT ?? '', request.requestId);
    assert.equal(script('scripts/report-hash.ts', [dir], env).stdout.trim(), view.reportSha256);
    assert.ok(fs.existsSync(path.join(dir, 'reviewers/index.json')));
    await proc.stop();
  });

  test('5: an infra failure is refunded once; critical findings are attested, never refunded', async () => {
    step(5, 'MOCK_ENGINE_FAIL=infra, then =findings');
    const infra = worker({ MOCK_ENGINE_FAIL: 'infra' });
    const failed = await queuedRequest(base, pool);
    const refunded = await until(failed.requestId, ['refunded']);
    assert.ok(refunded.refund_tx);
    assert.equal(await refunds(failed.requestHash), 1);
    await infra.stop();
    const findings = worker({ MOCK_ENGINE_FAIL: 'findings' });
    const critical = await queuedRequest(base, pool);
    assert.equal((await until(critical.requestId, ['done'])).max_severity, 'critical');
    assert.equal(await refunds(critical.requestHash), 0);
    await findings.stop();
  });

  test('6: kill -9 mid-run, restart: one more attempt, one attestation', async () => {
    step(6, 'SIGKILL the worker mid-run and restart it');
    const request = await queuedRequest(base, pool);
    const doomed = worker({ MOCK_ENGINE_STEP_MS: '2000' });
    await waitFor(async () => (await status(request.requestId))?.status === 'running');
    await doomed.stop('SIGKILL');
    const again = worker();
    const row = await until(request.requestId, ['done']);
    assert.equal(row.attempts, 2);
    assert.equal(await attests(request.requestHash), 1);
    await again.stop();
  });

  test('7 and 9: three jobs with concurrency 1 show positions; admin refund rules', async () => {
    step(7, '3 queued, WORKER_CONCURRENCY=1');
    const queued = [await queuedRequest(base, pool), await queuedRequest(base, pool), await queuedRequest(base, pool)];
    assert.deepEqual(queued.map((q) => q.position), [1, 2, 3]);
    const serial = worker({ WORKER_CONCURRENCY: '1', MOCK_ENGINE_STEP_MS: '300' });
    await waitFor(async () => (await status(queued[0]!.requestId))?.status === 'running');
    const positions = await Promise.all(queued.slice(1).map(async (q) => (await call(base, `/api/requests/${q.requestId}`)).body.position));
    assert.deepEqual(positions, [1, 2]);
    step(9, 'admin refund: running -> queued for a worker -> refunded, done -> 409, no token -> 401');
    const running = queued[0]!;
    const path9 = `/api/admin/requests/${running.requestId}/refund`;
    assert.equal((await call(adminBase, path9, { method: 'POST' })).status, 401);
    const refunded = await call(adminBase, path9, { method: 'POST', headers: { 'x-admin-token': ADMIN_TOKEN } });
    assert.equal(refunded.status, 202, JSON.stringify(refunded.body));
    assert.equal((await until(running.requestId, ['refunded'])).status, 'refunded', 'a worker sends the queued refund');
    await until(queued[2]!.requestId, ['done']);
    const done = await call(adminBase, `/api/admin/requests/${queued[2]!.requestId}/refund`, { method: 'POST', headers: { 'x-admin-token': ADMIN_TOKEN } });
    assert.equal(done.status, 409);
    assert.equal(done.body.error.code, 'REFUND_NOT_ALLOWED');
    assert.equal((await call(base, path9, { method: 'POST', headers: { 'x-admin-token': ADMIN_TOKEN } })).status, 404, 'no admin route on the public port');
    assert.equal(await attests(running.requestHash), 0, 'a refunded request is never attested');
    assert.equal(await refunds(running.requestHash), 1);
    await serial.stop();
  });

  test('6b: SIGTERM mid-run hands the job back with its retry; another worker finishes it', async () => {
    step('6b', 'SIGTERM the worker mid-run');
    const request = await queuedRequest(base, pool);
    const draining = worker({ MOCK_ENGINE_STEP_MS: '20000' });
    await waitFor(async () => (await status(request.requestId))?.status === 'running');
    assert.equal(await draining.stop('SIGTERM'), 0);
    const jobs = await pool.query(`SELECT state, retry_count, retry_limit FROM pgboss.job WHERE name = 'review' AND singleton_key = $1 ORDER BY created_on`,
      [request.requestHash]);
    assert.deepEqual(jobs.rows.map((r) => [r.state, r.retry_count, r.retry_limit]), [['completed', 0, 1], ['created', 0, 1]], 'released, retry kept');
    const next = worker();
    const row = await until(request.requestId, ['done']);
    assert.equal(row.attempts, 2);
    assert.equal(await attests(request.requestHash), 1);
    await next.stop();
  });

  test('8: GET /api/ledger lists the paid requests with deposits, costs and refunds, no accounts', async () => {
    step(8, 'GET /api/ledger');
    const ledger = await call(base, '/api/ledger');
    assert.equal(ledger.status, 200);
    conforms('ledger-response', ledger.body);
    const paid = await pool.query(`SELECT r.id, r.status FROM request r JOIN payment p ON p.request_id = r.id`);
    assert.equal(ledger.body.totals.requests, paid.rows.length);
    assert.deepEqual(ledger.body.entries.map((e: { requestId: string }) => e.requestId).sort(), paid.rows.map((r) => r.id).sort());
    const refunded = paid.rows.filter((r) => r.status === 'refunded').length;
    assert.equal(BigInt(ledger.body.totals.refundedYocto), BigInt(refunded) * BigInt(ledger.body.entries[0].paidYocto));
    assert.doesNotMatch(JSON.stringify(ledger.body), /\.mock"/, 'no account id');
  });

  test('DoD: the provider key reaches no table, log or published file', async () => {
    const dump = await pool.query(`SELECT string_agg(t::text, '') AS s FROM (
      SELECT row_to_json(r)::text AS t FROM request r UNION ALL SELECT data::text FROM audit_log UNION ALL SELECT data::text FROM pgboss.job) x`);
    assert.ok(!String(dump.rows[0].s).includes(PLANTED_KEY));
    for (const proc of [api, ...workers]) assert.ok(!proc.output.includes(PLANTED_KEY));
    const files = fs.readdirSync(env.REPORTS_ROOT ?? '', { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    for (const file of files) assert.ok(!fs.readFileSync(path.join(file.parentPath, file.name), 'utf8').includes(PLANTED_KEY), file.name);
    assert.ok(files.length > 0);
  });
});
