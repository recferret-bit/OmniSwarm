// W09 wave check (@hack): demo steps 1, 2, 3, 5, 6 (SIGKILL and SIGTERM), 7 with real API and worker processes and
// the mock engine. Every terminal path ends `done` or `failed` exactly once, and a provider key (the account's own,
// or one planted in the worker env) appears nowhere in Postgres, logs or the published report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { call, conforms, queuedJob } from '../../../apps/api/test/helpers/flow.ts';
import { freshDatabase, NEEDS_DB, type TestDatabase } from '../../../apps/api/test/helpers/db.ts';
import { testEnv } from '../../../apps/api/test/helpers/stack.ts';
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
  const finished = async (id: string) => (await pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE request_id = $1 AND event IN ('review_done', 'review_failed')`, [id])).rows[0].n as number;

  before(async () => {
    db = await freshDatabase('w09');
    const port = await freePort();
    env = testEnv(db.url, { PORT: String(port), LOG_LEVEL: 'info' });
    assert.equal(script('src/bin/migrate.ts', [], env).status, 0);
    api = new Proc('src/bin/api.ts', env);
    base = `http://127.0.0.1:${port}`;
    await waitFor(async () => (await fetch(`${base}/api/ready`)).ok);
    pool = new pg.Pool({ connectionString: db.url, max: 3 });
    process.stdout.write(`# W09 API on port ${port}, workers use the mock engine\n`);
  });
  after(async () => {
    for (const proc of workers) await proc.stop();
    await pool?.end();
    await api?.stop();
    await db?.drop();
  });

  test('1-3: a queued request streams progress over SSE, is published once, and the hash recomputes', async () => {
    const request = await queuedJob(base);
    step(1, 'worker + GET /api/requests/:id/events');
    const events = streamEvents(`${base}/api/requests/${request.requestId}/events`);
    const proc = worker({ MOCK_ENGINE_STEP_MS: '200' });
    const seen = await events;
    for (const event of seen) conforms('progress-event', event);
    const percents = seen.filter((e) => e.progress).map((e) => e.progress.percent);
    assert.ok(percents.length >= 5, `${percents}`);
    assert.ok(seen.some((e) => e.progress?.phase === 'review' && e.progress.reviewer === 'scripted-baseline'));
    assert.equal(seen.at(-1).status, 'done');
    step(2, 'done: reportUrl, reportSha256, review_done');
    const view = (await call(base, `/api/requests/${request.requestId}`)).body;
    assert.equal(view.reportUrl, `https://reports.test/${request.requestId}/report.html`);
    assert.equal(await finished(request.requestId), 1);
    step(3, 'report-hash.ts recomputes the report hash');
    const dir = path.join(env.REPORTS_ROOT ?? '', request.requestId);
    assert.equal(script('scripts/report-hash.ts', [dir], env).stdout.trim(), view.reportSha256);
    assert.ok(fs.existsSync(path.join(dir, 'reviewers/index.json')));
    await proc.stop();
  });

  test('5: an infra failure fails the request once; critical findings still publish', async () => {
    step(5, 'MOCK_ENGINE_FAIL=infra, then =findings');
    const infra = worker({ MOCK_ENGINE_FAIL: 'infra' });
    const failed = await queuedJob(base);
    const failedRow = await until(failed.requestId, ['failed']);
    assert.equal(failedRow.failure_cause, 'sandbox_unavailable');
    assert.equal(await finished(failed.requestId), 1);
    await infra.stop();
    const findings = worker({ MOCK_ENGINE_FAIL: 'findings' });
    const critical = await queuedJob(base);
    assert.equal((await until(critical.requestId, ['done'])).max_severity, 'critical');
    assert.equal(await finished(critical.requestId), 1);
    await findings.stop();
  });

  test('6: kill -9 mid-run, restart: one more attempt, finished once', async () => {
    step(6, 'SIGKILL the worker mid-run and restart it');
    const request = await queuedJob(base);
    const doomed = worker({ MOCK_ENGINE_STEP_MS: '2000' });
    await waitFor(async () => (await status(request.requestId))?.status === 'running');
    await doomed.stop('SIGKILL');
    const again = worker();
    const row = await until(request.requestId, ['done']);
    assert.equal(row.attempts, 2);
    assert.equal(await finished(request.requestId), 1);
    await again.stop();
  });

  test('7: three jobs with concurrency 1 show their positions', async () => {
    step(7, '3 queued, WORKER_CONCURRENCY=1');
    const queued = [await queuedJob(base), await queuedJob(base), await queuedJob(base)];
    const first = await call(base, `/api/requests/${queued[0]!.requestId}`);
    assert.equal(first.body.position, 1);
    const serial = worker({ WORKER_CONCURRENCY: '1', MOCK_ENGINE_STEP_MS: '300' });
    await waitFor(async () => (await status(queued[0]!.requestId))?.status === 'running');
    const positions = await Promise.all(queued.slice(1).map(async (q) => (await call(base, `/api/requests/${q.requestId}`)).body.position));
    assert.deepEqual(positions, [1, 2]);
    for (const q of queued) await until(q.requestId, ['done']);
    await serial.stop();
  });

  test('6b: SIGTERM mid-run hands the job back with its retry; another worker finishes it', async () => {
    step('6b', 'SIGTERM the worker mid-run');
    const request = await queuedJob(base);
    const draining = worker({ MOCK_ENGINE_STEP_MS: '20000' });
    await waitFor(async () => (await status(request.requestId))?.status === 'running');
    assert.equal(await draining.stop('SIGTERM'), 0);
    const jobs = await pool.query(`SELECT state, retry_count, retry_limit FROM pgboss.job WHERE name = 'review' AND singleton_key = $1 ORDER BY created_on`,
      [request.requestId]);
    assert.deepEqual(jobs.rows.map((r) => [r.state, r.retry_count, r.retry_limit]), [['completed', 0, 1], ['created', 0, 1]], 'released, retry kept');
    const next = worker();
    const row = await until(request.requestId, ['done']);
    assert.equal(row.attempts, 2);
    assert.equal(await finished(request.requestId), 1);
    await next.stop();
  });

  test('DoD: no provider key reaches a table, log or published file', async () => {
    const dump = await pool.query(`SELECT string_agg(t::text, '') AS s FROM (
      SELECT row_to_json(r)::text AS t FROM request r UNION ALL SELECT data::text FROM audit_log UNION ALL SELECT data::text FROM pgboss.job) x`);
    const dumped = String(dump.rows[0].s);
    const keys = [PLANTED_KEY, 'near-test-key-not-real-0000'];
    for (const key of keys) assert.ok(!dumped.includes(key), 'the saved key is sealed in account_provider_key, which is not in this dump');
    for (const proc of [api, ...workers]) for (const key of keys) assert.ok(!proc.output.includes(key));
    const files = fs.readdirSync(env.REPORTS_ROOT ?? '', { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    for (const file of files) for (const key of keys) assert.ok(!fs.readFileSync(path.join(file.parentPath, file.name), 'utf8').includes(key), file.name);
    assert.ok(files.length > 0);
  });
});
