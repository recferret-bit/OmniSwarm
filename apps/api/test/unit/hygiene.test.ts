// W09-19 disk hygiene on temp dirs with a stubbed status lookup: what is kept, what is removed, and that
// a published report of a done request is never removed.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Status } from '../../src/modules/requests/state.ts';
import { runHygiene, type KnownRequest } from '../../src/worker/hygiene.ts';
import { publishReport } from '../../src/worker/publish.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';

const FIXTURE = path.join(APP_ROOT, 'test/fixtures/engine-report');
const HOUR = 3600 * 1000;
const NOW = Date.now();

function roots() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hygiene-'));
  return { runsRoot: path.join(base, 'runs'), reportsRoot: path.join(base, 'published'), keepRuns: 20, orphanReportRetentionH: 168 };
}

/** One attempt dir; `completed` copies the recorded report and an exit-0 result. */
function attempt(runsRoot: string, id: string, n: number, completed: boolean): string {
  const dir = path.join(runsRoot, id, String(n));
  fs.mkdirSync(dir, { recursive: true });
  if (completed) fs.cpSync(FIXTURE, path.join(dir, 'report'), { recursive: true });
  const result = { exitCode: completed ? 0 : 1, signal: null, timedOut: false, aborted: false, spawnError: null, durationMs: 1 };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result));
  return dir;
}

function publish(reportsRoot: string, id: string, ageMs = 0): string {
  const published = publishReport({ reportsRoot, requestId: id, sourceDir: FIXTURE, repo: 'near/near-sdk-rs', commitSha: 'a'.repeat(40), preset: 'scripted' });
  const at = new Date(NOW - ageMs);
  fs.utimesSync(published.dir, at, at);
  return published.dir;
}

function lookup(known: Map<string, KnownRequest>) {
  return async (ids: string[]) => new Map(ids.filter((id) => known.has(id)).map((id) => [id, known.get(id)!]));
}

const at = (status: Status, ageMs = 0): KnownRequest => ({ status, updatedMs: NOW - ageMs });

test('25 finished requests: the newest 20 keep their run dirs, all 25 published reports stay', async () => {
  const policy = roots();
  const known = new Map<string, KnownRequest>();
  const ids = Array.from({ length: 25 }, (_, i) => {
    const id = crypto.randomUUID();
    attempt(policy.runsRoot, id, 0, true);
    publish(policy.reportsRoot, id, 400 * 24 * HOUR);
    known.set(id, at('done', (25 - i) * HOUR));
    return id;
  });
  const result = await runHygiene(policy, lookup(known), NOW);
  assert.equal(result.runsRemoved, 5);
  assert.deepEqual(fs.readdirSync(policy.runsRoot).sort(), ids.slice(5).sort(), 'the oldest five by last status change go');
  assert.equal(fs.readdirSync(policy.reportsRoot).filter((name) => name !== '.staging').length, 25, 'a done report is never removed, however old');
});

test('a done request keeps only its published attempt; in-flight, failed and unknown requests are never touched', async () => {
  const policy = roots();
  const done = crypto.randomUUID();
  attempt(policy.runsRoot, done, 0, false);
  const kept = attempt(policy.runsRoot, done, 1, true);
  const known = new Map<string, KnownRequest>([[done, at('done')]]);
  const untouchable: string[] = [];
  for (const status of ['running', 'publishing', 'queued', 'failed'] as const) {
    const id = crypto.randomUUID();
    attempt(policy.runsRoot, id, 0, false);
    publish(policy.reportsRoot, id, 900 * HOUR);
    known.set(id, at(status, 900 * HOUR));
    untouchable.push(id);
  }
  const stranger = crypto.randomUUID();
  attempt(policy.runsRoot, stranger, 0, true);
  publish(policy.reportsRoot, stranger, 900 * HOUR);
  untouchable.push(stranger);
  const result = await runHygiene({ ...policy, keepRuns: 1 }, lookup(known), NOW);
  assert.equal(result.attemptsRemoved, 1);
  assert.deepEqual(fs.readdirSync(path.join(policy.runsRoot, done)), [path.basename(kept)]);
  for (const id of untouchable) {
    assert.ok(fs.existsSync(path.join(policy.runsRoot, id)), `run of ${known.get(id)?.status ?? 'unknown'} kept`);
    assert.ok(fs.existsSync(path.join(policy.reportsRoot, id, 'published.json')), `report of ${known.get(id)?.status ?? 'unknown'} kept`);
  }
});

test('an orphaned report (refunded after publication) goes after the retention; stale staging goes after an hour', async () => {
  const policy = roots();
  const old = crypto.randomUUID();
  const fresh = crypto.randomUUID();
  publish(policy.reportsRoot, old, 200 * HOUR);
  publish(policy.reportsRoot, fresh, 200 * HOUR);
  const known = new Map([[old, at('refunded', 169 * HOUR)], [fresh, at('refunded', 2 * HOUR)]]);
  const staleStaging = path.join(policy.reportsRoot, '.staging', 'x-1');
  const liveStaging = path.join(policy.reportsRoot, '.staging', 'x-2');
  for (const dir of [staleStaging, liveStaging]) fs.mkdirSync(dir, { recursive: true });
  fs.utimesSync(staleStaging, new Date(NOW - 2 * HOUR), new Date(NOW - 2 * HOUR));
  const result = await runHygiene(policy, lookup(known), NOW);
  assert.deepEqual({ reports: result.reportsRemoved, staging: result.stagingRemoved }, { reports: 1, staging: 1 });
  assert.ok(!fs.existsSync(path.join(policy.reportsRoot, old)));
  assert.ok(fs.existsSync(path.join(policy.reportsRoot, fresh)), 'orphaned for 2 h only');
  assert.ok(fs.existsSync(liveStaging), 'a publication in progress is left alone');
});
