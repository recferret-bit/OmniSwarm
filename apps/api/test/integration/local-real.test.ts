// A real local job end to end: the API spawns the real engine (`bin/audit demo`, scripted reviewers on the bundled
// fixture, Docker sandbox) and GET /api/local/jobs/:id serves the engine's live progress while it runs. Slow (two
// minutes) and needs Docker, so it runs only with OMNI_REAL_LOCAL=1 and DATABASE_URL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { validate } from '@omniswarm/schemas';
import { setLocalJobStarter, spawnLocalAudit, type LocalLaunch } from '../../src/modules/operator/local-audit.ts';
import { call } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { migratedDb, startApi, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

const REAL = process.env.OMNI_REAL_LOCAL === '1' ? NEEDS_DB : { skip: 'set OMNI_REAL_LOCAL=1 (and DATABASE_URL) to run the real engine through a local job' };

describe('a real local job shows live progress', REAL, () => {
  let t: TestDb;
  let api: ApiStack;
  before(async () => {
    t = await migratedDb('localreal');
    api = await startApi(t.env);
  });
  after(async () => {
    setLocalJobStarter(null);
    await api?.close();
    await t?.db.drop();
  });

  test('phases, then reviewers, then finished at 100% with the job done', { timeout: 600_000 }, async () => {
    // The real spawn and exit handling, with the demo as the engine command.
    setLocalJobStarter((launch: LocalLaunch) => spawnLocalAudit({ ...launch, argv: [launch.argv[0]!, 'demo', '--surface', 's1', '--out', launch.outDir] }));
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-real-local-')));
    const queued = await call(api.base, '/api/local/jobs', { method: 'POST', body: { path: dir } });
    assert.equal(queued.status, 201, JSON.stringify(queued.body));
    const id = queued.body.id as string;
    const seen: Array<{ status: string; percent: number; phase: string; state: string; reviewers: number }> = [];
    const final = await until(async () => {
      const reply = await call(api.base, `/api/local/jobs/${id}`);
      const progress = reply.body?.progress;
      if (progress) {
        assert.ok(validate('intake-api#progress', progress).ok, JSON.stringify(progress).slice(0, 300));
        seen.push({ status: reply.body.status, percent: progress.percent, phase: progress.phase, state: progress.detail?.state, reviewers: progress.detail?.reviewers?.length ?? 0 });
      }
      return reply.body?.status === 'done' || reply.body?.status === 'failed' ? reply : null;
    }, Number(process.env.OMNI_REAL_LOCAL_MS || 540_000), 1_000).catch(async (error) => {
      const last = await call(api.base, `/api/local/jobs/${id}`);
      throw new Error(`${(error as Error).message}; last seen ${JSON.stringify(seen.slice(-3))}; job ${JSON.stringify(last.body).slice(0, 600)}`);
    });
    assert.equal(final.body.status, 'done', JSON.stringify(final.body));
    const live = seen.filter((row) => row.status === 'running');
    assert.ok(live.length >= 2, `the job was seen running with progress at least twice (saw ${live.length})`);
    // The engine's last snapshot can land a moment before the exit handler marks the job done (it writes the PDF first),
    // so a terminal state may be seen on a still-running job; a running snapshot is never at 100%.
    const TERMINAL = ['finished', 'incomplete', 'failed', 'cancelled'];
    assert.ok(live.every((row) => TERMINAL.includes(row.state) || (row.state === 'running' && row.percent < 100)), JSON.stringify(live.filter((row) => !(TERMINAL.includes(row.state) || (row.state === 'running' && row.percent < 100)))));
    assert.ok(live.some((row) => row.reviewers > 0), 'the reviewers appear');
    const percents = seen.map((row) => row.percent);
    assert.deepEqual(percents, [...percents].sort((a, b) => a - b), 'the percent never goes back');
    // The demo's coverage gap (NEAR contract tests are not run offline) makes it INCOMPLETE VERIFICATION by design.
    assert.ok(['finished', 'incomplete'].includes(final.body.progress.detail.state), final.body.progress.detail.state);
    assert.equal(final.body.progress.percent, 100);
    assert.deepEqual(final.body.progress.detail.phases.map((p: { state: string }) => p.state), Array(8).fill('done'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
