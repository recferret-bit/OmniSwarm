// Crash recovery with real worker processes (`node src/bin/worker.ts`) killed with SIGKILL:
//  - mid-run: the missed heartbeat re-queues the job, a new worker runs attempt 2 in a fresh dir;
//  - between the chain attest and the status write: the retry sees the attestation and finishes;
//  - two workers racing for three jobs: every request runs exactly once.
// Every request ends with exactly one attestation on the mock chain.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chainEvents } from '../../src/chain/mock/mock-ledger.ts';
import { findRequest } from '../../src/db/repositories/requests.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';
import { queuedRequest } from '../helpers/flow.ts';
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

  const done = (id: string) => until(async () => {
    const row = await findRequest(api.deps.pool, id);
    return row?.status === 'done' ? row : null;
  }, 60_000, 200);

  test('SIGKILL mid-run: the job is re-run once in a new attempt dir and attested once', async () => {
    const request = await queuedRequest(api.base, api.deps.pool);
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
    assert.deepEqual(fs.readdirSync(path.join(t.config.storage.runsRoot, request.requestId)).sort(), ['0', '1']);
    const events = await chainEvents(api.deps.pool, request.requestHash);
    assert.equal(events.filter((event) => event === 'review_attested').length, 1);
    assert.equal(events.filter((event) => event === 'review_running').length, 1);
    await stop(second);
  });

  test('SIGKILL after the attest landed and before the status write: finished without a second attest', async () => {
    const request = await queuedRequest(api.base, api.deps.pool);
    const hanging = workerProcess({ ...t.env, MOCK_CHAIN_HANG_AFTER: 'attest' });
    children.push(hanging);
    await until(async () => (await chainEvents(api.deps.pool, request.requestHash)).includes('review_attested'), 30_000);
    await kill(hanging);
    assert.equal((await findRequest(api.deps.pool, request.requestId))?.status, 'publishing');
    const recovering = workerProcess(t.env);
    children.push(recovering);
    const row = await done(request.requestId);
    assert.equal(row.attest_tx, null, 'the lost tx hash is not invented');
    const events = await chainEvents(api.deps.pool, request.requestHash);
    assert.equal(events.filter((event) => event === 'review_attested').length, 1);
    assert.equal(fs.readdirSync(path.join(t.config.storage.runsRoot, request.requestId)).length, 1, 'the engine did not run again');
    await stop(recovering);
  });

  test('two worker processes race for three jobs: each runs exactly once', async () => {
    const requests = [await queuedRequest(api.base, api.deps.pool), await queuedRequest(api.base, api.deps.pool), await queuedRequest(api.base, api.deps.pool)];
    const env = { ...t.env, MOCK_ENGINE_STEP_MS: '100', WORKER_CONCURRENCY: '2' };
    const racers = [workerProcess(env), workerProcess(env)];
    children.push(...racers);
    for (const request of requests) {
      const row = await done(request.requestId);
      assert.equal(row.attempts, 1);
      assert.deepEqual(fs.readdirSync(path.join(t.config.storage.runsRoot, request.requestId)), ['0']);
      assert.equal((await chainEvents(api.deps.pool, request.requestHash)).filter((event) => event === 'review_attested').length, 1);
    }
    await Promise.all(racers.map(stop));
    assert.ok(racers.every((child) => child.exitCode === 0), 'SIGTERM drains and exits 0');
  });
});
