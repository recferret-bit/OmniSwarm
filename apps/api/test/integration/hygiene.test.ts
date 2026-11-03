// W09-19 gate with real mock-engine runs: 25 jobs, then the maintenance step's disk hygiene on the
// real database leaves 20 run dirs and all 25 published reports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../../src/config/load.ts';
import { runHygiene, statusLookup } from '../../src/worker/hygiene.ts';
import { queuedRequest } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { migratedDb, startApi, startWorkerInProcess, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

describe('disk hygiene after real runs', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  before(async () => {
    t = await migratedDb('hygiene', { MAX_QUEUE: '100', MOCK_ENGINE_STEP_MS: '5', WORKER_CONCURRENCY: '4' });
    api = await startApi(t.env);
  });
  after(async () => {
    await api?.close();
    await t?.db.drop();
  });

  test('25 mock jobs -> 20 run dirs remain, all 25 published reports remain', async () => {
    const worker = await startWorkerInProcess(t.env);
    try {
      const ids: string[] = [];
      for (let i = 0; i < 25; i++) ids.push((await queuedRequest(api.base, api.deps.pool)).requestId);
      await until(async () => {
        const done = await api.deps.pool.query(`SELECT count(*)::int AS n FROM request WHERE status = 'done' AND id = ANY($1::uuid[])`, [ids]);
        return done.rows[0].n === 25;
      }, 120_000, 250);
    } finally {
      await worker.close();
    }
    const { storage } = loadConfig('worker', t.env);
    const result = await runHygiene(storage, statusLookup(api.deps.pool));
    assert.equal(result.runsRemoved, 5);
    assert.equal(fs.readdirSync(storage.runsRoot).length, 20);
    assert.equal(fs.readdirSync(storage.reportsRoot).filter((name) => name !== '.staging').length, 25);
    assert.deepEqual(await runHygiene(storage, statusLookup(api.deps.pool)), { runsRemoved: 0, attemptsRemoved: 0, reportsRemoved: 0, stagingRemoved: 0 });
  });
});
