// Crash recovery with real worker processes (`node src/bin/worker.ts`) killed with SIGKILL:
//  - mid-run: the missed heartbeat re-queues the job, a new worker runs attempt 2 in a fresh dir;
//  - between the report publication and the `done` status write: the retry finishes without running the engine;
//  - SIGTERM mid-run: the engine stops at once and the job is handed back without spending its retry;
//  - two workers racing for three jobs: every request runs exactly once.
// Every request ends `done` (or `failed`) exactly once.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { findRequest, transition } from '../../src/db/repositories/requests.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';
import { queuedJob } from '../helpers/flow.ts';
import { publishReport } from '../../src/worker/publish.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { migratedDb, startApi, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

function workerProcess(env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, [path.join(APP_ROOT, 'src/bin/worker.ts')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr?.resume();
  return child;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

function kill(child: ChildProcess): Promise<unknown> {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  return exited;
}

describe('crash recovery with real worker processes', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  const children: ChildProcess[] = [];
  before(async () => {
    t = await migratedDb('crash');
    api = await startApi(t.env);
  });
  after(async () => {
    for (const child of children) await stop(child);
    await api?.close();
    await t?.db.drop();
  });

  /** The re-run used a fresh dir `1`; dir `0` may already be pruned by the maintenance cron's hygiene. */
  const secondAttemptDir = (id: string) => {
    const dirs = fs.readdirSync(path.join(t.config.storage.runsRoot, id)).sort();
    assert.ok(dirs.includes('1') && dirs.every((dir) => dir === '0' || dir === '1'), `attempt dirs: ${dirs}`);
    assert.ok(fs.existsSync(path.join(t.config.storage.runsRoot, id, '1', 'result.json')), 'attempt 2 ran in its own dir');
  };

  const done = (id: string) => until(async () => {
    const row = await findRequest(api.deps.pool, id);
    return row?.status === 'done' ? row : null;
  }, 60_000, 200);

  test('SIGKILL mid-run: the job is re-run once in a new attempt dir and finished once', async () => {
    const request = await queuedJob(api.base);
    const first = workerProcess({ ...t.env, MOCK_ENGINE_STEP_MS: '1500' });
    children.push(first);
    await until(async () => {
      const progress = await api.deps.pool.query(`SELECT count(*)::int AS n FROM request_progress WHERE request_id = $1`, [request.requestId]);
      return progress.rows[0].n >= 2;
    }, 30_000);
    await kill(first);
    assert.equal((await findRequest(api.deps.pool, request.requestId))?.status, 'running');
    const second = workerProcess({ ...t.env, MOCK_ENGINE_STEP_MS: '20' });
    children.push(second);
    const row = await done(request.requestId);
    assert.equal(row.attempts, 2);
    secondAttemptDir(request.requestId);
    const events = await api.deps.pool.query<{ event: string }>(`SELECT event FROM audit_log WHERE request_id = $1`, [request.requestId]);
    assert.equal(events.rows.filter((r) => r.event === 'review_done').length, 1);
    await stop(second);
  });

  test('a crash after the report was published and before the done write: finished without running the engine again', async () => {
    const request = await queuedJob(api.base);
    // What a worker killed between the publication and the status write leaves behind.
    const fixture = path.join(APP_ROOT, 'test/fixtures/engine-report');
    const published = publishReport({ reportsRoot: t.config.storage.reportsRoot, requestId: request.requestId, sourceDir: fixture, repo: 'near/near-sdk-rs', commitSha: 'a'.repeat(40), preset: 'account-nearai' });
    const now = new Date();
    await transition(api.deps.pool, request.requestId, { to: 'running', actor: 'test', event: 'review_started', now });
    await transition(api.deps.pool, request.requestId, {
      to: 'publishing', actor: 'test', event: 'report_published', now,
      patch: { reportSha256: published.reportSha256, reportUrl: `https://reports.test/${request.requestId}/report.html`, maxSeverity: 'medium', incomplete: false },
    });
    const recovering = workerProcess(t.env);
    children.push(recovering);
    const row = await done(request.requestId);
    assert.equal(row.report_sha256, published.reportSha256);
    assert.ok(!fs.existsSync(path.join(t.config.storage.runsRoot, request.requestId, '0', 'result.json')), 'the engine did not run');
    const events = await api.deps.pool.query<{ event: string }>(`SELECT event FROM audit_log WHERE request_id = $1 AND event = 'review_done'`, [request.requestId]);
    assert.equal(events.rowCount, 1);
    await stop(recovering);
  });

  /** SIGTERM a real worker process while its engine runs; returns how long the drain took. */
  async function sigtermMidRun(requestId: string): Promise<number> {
    const slow = workerProcess({ ...t.env, MOCK_ENGINE_STEP_MS: '20000' });
    children.push(slow);
    await until(async () => (await findRequest(api.deps.pool, requestId))?.status === 'running', 30_000);
    const started = Date.now();
    await stop(slow);
    assert.equal(slow.exitCode, 0);
    return Date.now() - started;
  }

  const reviewJobs = async (requestId: string) => (await api.deps.pool.query<{ state: string; retry_count: number; retry_limit: number; output: unknown }>(
    `SELECT state, retry_count, retry_limit, output FROM pgboss.job WHERE name = 'review' AND singleton_key = $1 ORDER BY created_on`, [requestId])).rows;

  test('SIGTERM aborts the running engine at once, exits 0, and hands the job back with its retry', async () => {
    const request = await queuedJob(api.base);
    const took = await sigtermMidRun(request.requestId);
    assert.ok(took < 15_000, `stopped in ${took} ms, not after the 20 s engine step`);
    const [released, again] = await reviewJobs(request.requestId);
    assert.equal(released?.state, 'completed');
    assert.deepEqual(released?.output, { released: true });
    assert.deepEqual({ state: again?.state, retryCount: again?.retry_count, retryLimit: again?.retry_limit }, { state: 'created', retryCount: 0, retryLimit: 1 });
    const next = workerProcess(t.env);
    children.push(next);
    const row = await done(request.requestId);
    assert.equal(row.attempts, 2);
    secondAttemptDir(request.requestId);
    await stop(next);
  });

  test('the retry kept across a SIGTERM is still there: a crashing engine afterwards is retried once, then failed', async () => {
    const request = await queuedJob(api.base);
    await sigtermMidRun(request.requestId);
    const crashing = workerProcess({ ...t.env, MOCK_ENGINE_FAIL: 'crash' });
    children.push(crashing);
    const row = await until(async () => {
      const current = await findRequest(api.deps.pool, request.requestId);
      return current?.status === 'failed' ? current : null;
    }, 60_000, 200);
    // 1 interrupted run (free) + the first crash + its retry.
    assert.equal(row.attempts, 3);
    assert.match(row.failure_cause ?? '', /^engine_error_after_retry/);
    await stop(crashing);
  });

  test('two worker processes race for three jobs: each runs exactly once', async () => {
    const requests = [await queuedJob(api.base), await queuedJob(api.base), await queuedJob(api.base)];
    const env = { ...t.env, MOCK_ENGINE_STEP_MS: '100', WORKER_CONCURRENCY: '2' };
    const racers = [workerProcess(env), workerProcess(env)];
    children.push(...racers);
    for (const request of requests) {
      const row = await done(request.requestId);
      assert.equal(row.attempts, 1);
      assert.deepEqual(fs.readdirSync(path.join(t.config.storage.runsRoot, request.requestId)), ['0']);
    }
    await Promise.all(racers.map(stop));
    assert.ok(racers.every((child) => child.exitCode === 0), 'SIGTERM drains and exits 0');
  });
});
