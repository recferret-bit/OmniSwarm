// The engine's live snapshot as a progress row (worker/progress-detail.ts), the tailer's write throttle, and the
// mock engine's snapshots. Every row the worker stores must validate against intake-api.schema.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validate } from '@omniswarm/schemas';
import { MockEngineRunner } from '../../src/engine/mock/mock-runner.ts';
import { progressFromSnapshot } from '../../src/worker/progress-detail.ts';
import { DETAIL_EVERY_MS, ProgressTailer, snapshot } from '../../src/worker/progress-tailer.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';

function outWith(progress: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-detail-'));
  fs.mkdirSync(path.join(dir, 'harness', 'host'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'harness', 'host', 'progress.json'), typeof progress === 'string' ? progress : JSON.stringify(progress));
  return dir;
}

const PHASES = ['prepare', 'tests', 'review', 'crosscheck', 'debate', 'adjudicate', 'general-review', 'report'];
const engineSnapshot = (patch: Record<string, unknown> = {}) => ({
  version: 1, state: 'running', phase: 'review', percent: 46.4,
  startedAt: '2026-11-10T12:44:51.000Z', updatedAt: '2026-11-10T13:31:20.000Z', elapsedMs: 2_789_000,
  phases: PHASES.map((name, i) => ({ name, state: i < 2 ? 'done' : i === 2 ? 'running' : 'pending' })),
  reviewers: [
    { id: 'cli-claude-opus', state: 'done', jobsDone: 1, jobs: 1, passes: 2 },
    { id: 'cli-grok-grok-4-7', state: 'running', jobsDone: 0, jobs: 1, passes: 2, pass: 1, calls: 31, budget: 40, surface: 'S3', idleMs: 185_000 },
    { id: 'cli-codex-gpt-6-1-sol', state: 'running', jobsDone: 0, jobs: 1, passes: 2, pass: 2, calls: 3, budget: 40, surface: 'S3', idleMs: 1_000 },
  ],
  debate: { clusters: 4, heard: 1 },
  ...patch,
});
const asEvent = (progress: unknown) => ({ status: 'running', progress, at: '2026-11-10T13:31:20.000Z' });

test('the snapshot becomes a schema-valid row that names the reviewer furthest behind', () => {
  const row = progressFromSnapshot(outWith(engineSnapshot()));
  assert.ok(row);
  assert.deepEqual([row.phase, row.percent, row.reviewer, row.pass], ['review', 46, 'cli-grok-grok-4-7', 1]);
  const check = validate('intake-api#progress-event', asEvent(row));
  assert.ok(check.ok, JSON.stringify(check.errors));
  const detail = row.detail as { reviewers: Array<Record<string, unknown>>; phases: unknown[]; debate: unknown };
  assert.equal(detail.reviewers.length, 3);
  assert.equal(detail.phases.length, 8);
  assert.deepEqual(detail.debate, { clusters: 4, heard: 1 });
});

test('fields outside the contract, and malformed values, never leave the worker', () => {
  const dirty = engineSnapshot({
    note: 'Missing owner check in withdraw at src/vault.rs:42',
    phases: [...PHASES.map((name) => ({ name, state: 'pending', title: 'leak' })), { name: 'exploit', state: 'running' }, { name: 'review', state: 'paused' }],
    reviewers: [
      { id: 'cli-claude-opus', state: 'running', jobsDone: 0, jobs: 1, passes: 2, pass: 1, calls: 3, budget: 40, surface: 'S3', lastFinding: 'Missing owner check' },
      { id: 'Not An Id!', state: 'running', jobsDone: 0, jobs: 1, passes: 2 },
      { id: 'cli-codex', state: 'thinking', jobsDone: 0, jobs: 1, passes: 2 },
      { id: 'cli-grok', state: 'running', jobsDone: -1, jobs: 0, passes: 2 },
      { id: 'cli-agy', state: 'running', jobsDone: 0, jobs: 1, passes: 2, calls: 1.5, surface: 'S9', idleMs: -4 },
    ],
    debate: { clusters: 2, heard: 'two', title: 'x' },
    crosscheck: 'none',
    startedAt: 'yesterday',
  });
  const row = progressFromSnapshot(outWith(dirty));
  assert.ok(row);
  const text = JSON.stringify(row);
  for (const leak of ['Missing owner', 'src/vault.rs', 'leak', 'exploit', 'paused', 'Not An Id', 'thinking', 'yesterday', '"title"']) assert.equal(text.includes(leak), false, leak);
  const detail = row.detail as { reviewers: Array<Record<string, unknown>>; phases: unknown[]; debate: unknown; crosscheck?: unknown; startedAt?: unknown };
  assert.deepEqual(detail.reviewers.map((r) => r.id), ['cli-claude-opus', 'cli-agy']);
  assert.deepEqual(Object.keys(detail.reviewers[1]!).sort(), ['id', 'jobs', 'jobsDone', 'passes', 'state'], 'a fractional count, a bad surface and a negative idle time are dropped');
  assert.equal(detail.phases.length, 8);
  assert.deepEqual(detail.debate, { clusters: 2 });
  assert.equal(detail.crosscheck, undefined);
  assert.equal(detail.startedAt, undefined);
  assert.ok(validate('intake-api#progress-event', asEvent(row)).ok);
});

test('no snapshot, an unreadable one or an unknown version falls back to inferring from the report files', () => {
  const fallback = { phase: 'starting', percent: 5 };
  assert.deepEqual(snapshot(fs.mkdtempSync(path.join(os.tmpdir(), 'progress-none-'))), fallback);
  assert.deepEqual(snapshot(outWith('{not json')), fallback);
  assert.deepEqual(snapshot(outWith(engineSnapshot({ version: 2 }))), fallback);
  assert.deepEqual(snapshot(outWith(engineSnapshot({ state: 'paused' }))), fallback);
  assert.deepEqual(snapshot(outWith([1, 2])), fallback);
  // An out-of-range percent and an unknown phase are bounded, not trusted.
  const odd = progressFromSnapshot(outWith(engineSnapshot({ percent: 140, phase: 'pwned' })));
  assert.deepEqual([odd?.phase, odd?.percent], ['starting', 0]);
});

interface Appended { progress: { percent: number; phase: string; detail?: unknown }; at: number }
function fakePool(appended: Appended[]) {
  return {
    async query(text: string, params: unknown[]) {
      if (text.includes('INSERT INTO request_progress')) appended.push({ progress: { phase: String(params[2]), percent: Number(params[5]), detail: params[7] ? JSON.parse(String(params[7])) : undefined }, at: (params[1] as Date).getTime() });
      if (text.includes('FROM request WHERE id')) return { rows: [{ id: 'r', status: 'running', parent_id: null }] };
      return { rows: [] };
    },
  };
}

test('state, phase and reviewer changes are written at once, call counts at most every thirty seconds', async () => {
  const dir = outWith(engineSnapshot());
  const appended: Appended[] = [];
  let now = 1_000_000;
  const tailer = new ProgressTailer({ pool: fakePool(appended) as never, clock: { now: () => new Date(now) } }, 'r', dir, () => {});
  const write = (patch: Record<string, unknown>) => fs.writeFileSync(path.join(dir, 'harness', 'host', 'progress.json'), JSON.stringify(engineSnapshot(patch)));
  // The three reviewers of engineSnapshot(), in their order, with grok's row patched.
  const grok = (patch: Record<string, unknown> = {}) => ({
    reviewers: (engineSnapshot().reviewers as Array<Record<string, unknown>>).map((row) => (row.id === 'cli-grok-grok-4-7' ? { ...row, ...patch } : row)),
  });
  await tailer.tick();
  assert.equal(appended.length, 1);
  write({ ...grok({ calls: 32 }), percent: 47 });
  now += 10_000;
  await tailer.tick();
  assert.equal(appended.length, 1, 'a call count and the percent it moves wait');
  now += DETAIL_EVERY_MS;
  await tailer.tick();
  assert.equal(appended.length, 2, 'and are written once thirty seconds have passed');
  now += 1_000;
  await tailer.tick();
  assert.equal(appended.length, 2, 'the same snapshot is never written twice');
  // A new pass, a stall, a phase and a run state each go out at once.
  for (const patch of [{ ...grok({ pass: 2, calls: 0, idleMs: 200_000 }), percent: 47 }, { ...grok({ pass: 2, calls: 0, idleMs: 1_000 }), percent: 47 }, { ...grok({ pass: 2, calls: 0, idleMs: 200_000 }), percent: 71, phase: 'crosscheck' }, { ...grok({ pass: 2, calls: 0, idleMs: 200_000 }), percent: 71, phase: 'crosscheck', state: 'incomplete' }]) {
    const before = appended.length;
    write(patch);
    now += 1_000;
    await tailer.tick();
    assert.equal(appended.length, before + 1, JSON.stringify(patch).slice(0, 80));
  }
  // The idle clock alone is not a change; a lower percent is never written.
  write({ ...grok({ pass: 2, calls: 0, idleMs: 400_000 }), percent: 71, phase: 'crosscheck', state: 'incomplete' });
  now += DETAIL_EVERY_MS;
  await tailer.tick();
  write({ phase: 'review', percent: 40 });
  now += DETAIL_EVERY_MS;
  await tailer.tick();
  assert.equal(appended.length, 6);
});

test('the engine snapshot replaces the inferred starting row, and the last snapshot is written on stop', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-first-'));
  const appended: Appended[] = [];
  let now = 2_000_000;
  const tailer = new ProgressTailer({ pool: fakePool(appended) as never, clock: { now: () => new Date(now) } }, 'r', dir, () => {});
  await tailer.tick();
  assert.deepEqual(appended.map((row) => [row.progress.phase, row.progress.percent]), [['starting', 5]]);
  fs.mkdirSync(path.join(dir, 'harness', 'host'), { recursive: true });
  const put = (patch: Record<string, unknown>) => fs.writeFileSync(path.join(dir, 'harness', 'host', 'progress.json'), JSON.stringify(engineSnapshot(patch)));
  put({ phase: 'prepare', percent: 0, reviewers: [] });
  now += 1_000;
  await tailer.tick();
  assert.deepEqual([appended.at(-1)?.progress.phase, appended.at(-1)?.progress.percent], ['prepare', 5], 'a 0% snapshot replaces the 5% guess, at the 5% already shown');
  // A call count right before the end would wait for the throttle; stop() writes it anyway.
  put({ phase: 'prepare', percent: 7, reviewers: [] });
  now += 1_000;
  await tailer.tick();
  const before = appended.length;
  await tailer.stop();
  assert.equal(appended.length, before + 1);
  assert.equal(appended.at(-1)?.progress.percent, 7);
});

test('the mock engine writes a schema-valid snapshot at every step, finished only at the end, failed on a lost sandbox', async () => {
  const fixtureDir = path.join(APP_ROOT, 'test', 'fixtures', 'engine-report');
  const seen: Array<{ state: string; percent: number; phase: string }> = [];
  for (const fail of [null, 'infra'] as const) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-progress-'));
    const runner = new MockEngineRunner({ fixtureDir, stepMs: 1, fail });
    const watcher = setInterval(() => { const row = progressFromSnapshot(out); if (row) seen.push({ state: String((row.detail as { state: string }).state), percent: row.percent, phase: row.phase }); }, 0);
    await runner.run({ repo: 'o/r', commitSha: 'a'.repeat(40), preset: 'panel', outDir: out, logPath: path.join(out, 'engine.log') } as never, new AbortController().signal);
    clearInterval(watcher);
    const last = progressFromSnapshot(out);
    assert.ok(last);
    assert.ok(validate('intake-api#progress-event', asEvent(last)).ok, fail ?? 'happy');
    const state = (last.detail as { state: string }).state;
    if (fail === 'infra') assert.deepEqual([state, last.percent < 100], ['failed', true]);
    else assert.deepEqual([state, last.percent], ['finished', 100]);
  }
  assert.ok(seen.filter((row) => row.state === 'running').every((row) => row.percent < 100));
});
