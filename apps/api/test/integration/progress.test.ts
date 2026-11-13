// Live progress through the database: the engine snapshot's detail is stored, served by GET and SSE, and a
// split review's parent row follows its themes. Skips without DATABASE_URL, like the other integration tests.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { appendProgress, latestProgress } from '../../src/db/repositories/progress.ts';
import { findRequest, insertThemeRequest, transition } from '../../src/db/repositories/requests.ts';
import { ProgressTailer, themeProgress } from '../../src/worker/progress-tailer.ts';
import { call, conforms, queuedJob } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { migratedDb, startApi, type ApiStack, type TestDb } from '../helpers/stack.ts';

const PHASES = ['prepare', 'tests', 'review', 'crosscheck', 'debate', 'adjudicate', 'general-review', 'report'];
function outDir(snapshot: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-int-'));
  fs.mkdirSync(path.join(dir, 'harness', 'host'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'harness', 'host', 'progress.json'), JSON.stringify(snapshot));
  return dir;
}
const running = (percent: number, phase = 'review') => ({
  version: 1, state: 'running', phase, percent, elapsedMs: 60_000,
  phases: PHASES.map((name) => ({ name, state: name === phase ? 'running' : PHASES.indexOf(name) < PHASES.indexOf(phase) ? 'done' : 'pending' })),
  reviewers: [{ id: 'cli-grok-grok-4-7', state: 'running', jobsDone: 0, jobs: 1, passes: 2, pass: 1, calls: 12, budget: 40, surface: 'S3', idleMs: 1_000 }],
});

function sse(url: string, headers: Record<string, string> = {}): Promise<any[]> {
  const events: any[] = [];
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const data = buffer.slice(0, cut).split('\n').find((line) => line.startsWith('data: '));
          buffer = buffer.slice(cut + 2);
          if (data) events.push(JSON.parse(data.slice(6)));
          // The request stays running, so the stream never ends by itself: stop after the status event.
          if (events.some((event) => !event.progress)) { request.destroy(); resolve(events); }
        }
      });
    });
    request.on('error', (error) => (events.length ? resolve(events) : reject(error)));
  });
}

describe('live progress through the database', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  before(async () => {
    t = await migratedDb('progress');
    api = await startApi(t.env);
  });
  after(async () => {
    await api?.close();
    await t?.db.drop();
  });

  async function runningRequest() {
    const created = await queuedJob(api.base);
    const now = new Date();
    await transition(api.deps.pool, created.requestId, { to: 'running', actor: 'test', event: 'review_started', now });
    return created.requestId;
  }

  test('the engine snapshot reaches GET /api/requests/:id with its detail, and the list shows phase and percent', async () => {
    const id = await runningRequest();
    const tailer = new ProgressTailer({ pool: api.deps.pool, clock: { now: () => new Date() } }, id, outDir(running(40)));
    await tailer.tick();
    const view = await call(api.base, `/api/requests/${id}`);
    assert.equal(view.status, 200);
    conforms('request-status-response', view.body);
    assert.equal(view.body.progress.reviewer, 'cli-grok-grok-4-7');
    assert.equal(view.body.progress.detail.reviewers[0].calls, 12);
    assert.equal(view.body.progress.detail.phases.length, 8);
    // A request with no detail (an older engine) still has a plain progress object.
    const plain = await runningRequest();
    await appendProgress(api.deps.pool, plain, { phase: 'review', percent: 30 }, new Date());
    const old = await call(api.base, `/api/requests/${plain}`);
    assert.deepEqual(old.body.progress, { phase: 'review', percent: 30 });
  });

  test('a fresh stream starts at the latest snapshot row; rows without a snapshot replay from the start', async () => {
    const id = await runningRequest();
    for (const percent of [20, 30, 40]) await appendProgress(api.deps.pool, id, { phase: 'review', percent, detail: { state: 'running', phases: [] } }, new Date());
    const fresh = await sse(`${api.base}/api/requests/${id}/events`);
    assert.deepEqual(fresh.filter((event) => event.progress).map((event) => event.progress.percent), [40]);
    for (const event of fresh) conforms('progress-event', event);
    // A reconnect with Last-Event-ID resumes after that row, as before.
    const rows = await api.deps.pool.query('SELECT id FROM request_progress WHERE request_id = $1 ORDER BY id', [id]);
    const resumed = await sse(`${api.base}/api/requests/${id}/events`, { 'last-event-id': String(rows.rows[0].id) });
    assert.deepEqual(resumed.filter((event) => event.progress).map((event) => event.progress.percent), [30, 40]);
    // An older engine's rows (no snapshot) are all replayed: the page builds its phase list from them.
    const legacy = await runningRequest();
    for (const phase of ['starting', 'review', 'debate']) await appendProgress(api.deps.pool, legacy, { phase, percent: 50 }, new Date());
    const replayed = await sse(`${api.base}/api/requests/${legacy}/events`);
    assert.deepEqual(replayed.filter((event) => event.progress).map((event) => event.progress.phase), ['starting', 'review', 'debate']);
  });

  test("a split review's parent row follows its themes, and is never complete while one is failing", async () => {
    const parentId = await runningRequest();
    const parent = (await findRequest(api.deps.pool, parentId))!;
    const now = new Date();
    const theme = async (name: string) => {
      const id = crypto.randomUUID();
      await insertThemeRequest(api.deps.pool, { id, parent, theme: name, slicePath: `/tmp/${name}`, now });
      return id;
    };
    assert.equal(await themeProgress(api.deps.pool, parentId), null);
    const web3 = await theme('web3');
    const apps = await theme('apps');
    await transition(api.deps.pool, web3, { to: 'running', actor: 'test', event: 'review_started', now });
    // The theme's tailer writes its own row, then refreshes the parent.
    const tailer = new ProgressTailer({ pool: api.deps.pool, clock: { now: () => new Date() } }, web3, outDir(running(50)));
    await tailer.tick();
    let row = await latestProgress(api.deps.pool, parentId);
    assert.ok(row);
    assert.equal(row.phase, 'themes');
    assert.deepEqual((row.detail as { themes: unknown[] }).themes, [
      { theme: 'web3', status: 'running', phase: 'review', percent: 50 },
      { theme: 'apps', status: 'queued', percent: 0 },
    ]);
    assert.equal(Number(row.percent), 25);
    const view = await call(api.base, `/api/requests/${parentId}`);
    conforms('request-status-response', view.body);
    assert.equal(view.body.progress.detail.state, 'running');
    // The same state again writes nothing new.
    const before = row.id;
    await tailer.tick();
    assert.equal((await latestProgress(api.deps.pool, parentId))?.id, before);
    // One theme failing: the parent is incomplete and below 100 even when the other theme is done.
    await transition(api.deps.pool, apps, { to: 'running', actor: 'test', event: 'review_started', now });
    await transition(api.deps.pool, apps, { to: 'failed', actor: 'test', event: 'review_failed', now });
    await transition(api.deps.pool, web3, { to: 'publishing', actor: 'test', event: 'report_published', now });
    const composed = await themeProgress(api.deps.pool, parentId);
    assert.equal((composed?.detail as { state: string }).state, 'incomplete');
    assert.ok((composed?.percent ?? 100) < 100);
  });
});
