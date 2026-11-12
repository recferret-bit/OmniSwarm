import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PHASES, STALL_MS, createProgress, createSticky, readProgress, statusLine } from './orchestrator-progress.mjs';
import { trackPhases } from './docker-agent-orchestrator.mjs';
import { heartbeatReporter } from './orchestrator-session.mjs';
import { writeJson } from './report-util-files.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'progress-'));
const S3 = { code: 'S3', id: 's3', slug: 'logic' };
const job = (adapter, state = 'pending', surface = S3) => ({ name: `${adapter}-${surface.id}-${surface.slug}`, adapter, surface, state });
const budgets = { passes: 2, toolBudget: 40 };

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
const spend = (out, reviewer, key, calls) => writeJson(out, `harness/budget-${reviewer}.json`, { version: 1, reviewer, passes: { [key]: { calls } } });
const passDone = (out, reviewer, pass) => writeJson(out, `harness/usage/${reviewer}/s3-pass-${pass}.json`, { k: pass });

test('the snapshot follows phases, passes and calls, and the percent only moves forward', () => {
  const out = temp();
  const c = clock();
  const jobs = [job('claude'), job('codex')];
  const p = createProgress({ output: out, jobs, budgets, now: c.now });
  p.phaseStart('prepare');
  let snap = readProgress(out);
  assert.deepEqual([snap.version, snap.state, snap.phase, snap.percent], [1, 'running', 'prepare', 0]);
  assert.deepEqual(snap.phases.map((row) => row.name), PHASES.map((row) => row.name));
  p.phaseEnd('prepare');
  p.phaseStart('tests');
  p.phaseEnd('tests');
  p.phaseStart('review');
  assert.equal(readProgress(out).percent, 10);
  jobs[0].state = 'running';
  spend(out, 'claude', 's3:1', 20);
  snap = p.refresh();
  const claude = snap.reviewers.find((row) => row.id === 'claude');
  assert.deepEqual([claude.state, claude.pass, claude.passes, claude.calls, claude.budget, claude.surface], ['running', 1, 2, 20, 40, 'S3']);
  // Half of one of two passes of one of two reviewers: 1/8 of the review share.
  assert.equal(snap.percent, Math.round(10 + 60 * (0.5 / 2) / 2));
  passDone(out, 'claude', 1);
  spend(out, 'claude', 's3:2', 0);
  assert.equal(p.refresh().reviewers[0].pass, 2);
  const before = p.refresh().percent;
  // A budget file rewritten with fewer calls never moves the bar back.
  spend(out, 'claude', 's3:2', 0);
  rmUsage(out);
  assert.ok(p.refresh().percent >= before);
  jobs[0].state = 'collected';
  jobs[1].state = 'collected';
  p.phaseEnd('review');
  assert.equal(p.refresh().percent, 70);
  assert.deepEqual(p.refresh().reviewers.map((row) => [row.id, row.state, row.jobsDone, row.jobs]), [['claude', 'done', 1, 1], ['codex', 'done', 1, 1]]);
});

function rmUsage(out) { fs.rmSync(path.join(out, 'harness', 'usage'), { recursive: true, force: true }); }

test('debate and adjudication counters fill their share, and only a clean finish reaches 100', () => {
  const out = temp();
  const p = createProgress({ output: out, jobs: [], budgets });
  for (const name of ['prepare', 'tests', 'review', 'crosscheck']) { p.phaseStart(name); p.phaseEnd(name); }
  p.phaseStart('debate');
  p.counter('debate', 1, 4);
  let snap = p.refresh();
  assert.deepEqual(snap.debate, { clusters: 4, heard: 1 });
  assert.equal(snap.percent, Math.round(78 + 10 / 4));
  p.phaseEnd('debate');
  p.phaseStart('adjudicate');
  p.counter('adjudicate', 3, 6);
  snap = p.refresh();
  assert.deepEqual(snap.debate, { clusters: 4, heard: 1, judged: 3, toJudge: 6 });
  assert.equal(snap.percent, 91);
  p.phaseEnd('adjudicate');
  p.phaseStart('general-review');
  p.phaseEnd('general-review');
  p.phaseStart('report');
  p.phaseEnd('report');
  assert.equal(p.refresh().percent, 99, 'every phase done but not finished: still below 100');
  assert.equal(p.finish('finished').percent, 100);
  assert.equal(readProgress(out).state, 'finished');
});

test('a failed, cancelled or incomplete run never shows 100 and marks what did not run', () => {
  for (const outcome of ['failed', 'cancelled', 'incomplete']) {
    const out = temp();
    const p = createProgress({ output: out, jobs: [], budgets });
    p.phaseStart('prepare'); p.phaseEnd('prepare');
    p.phaseStart('review');
    const snap = p.finish(outcome);
    assert.equal(snap.state, outcome);
    assert.ok(snap.percent < 100, outcome);
    const states = Object.fromEntries(snap.phases.map((row) => [row.name, row.state]));
    assert.deepEqual([states.prepare, states.review, states.debate, states.report], ['done', 'failed', 'skipped', 'skipped'], outcome);
    assert.equal(snap.phase, 'review', `${outcome}: the headline names the phase that stopped, not the last one`);
  }
});

test('a session with no agent activity is shown as stalled, and an active one is not', () => {
  const out = temp();
  const c = clock();
  const jobs = [job('grok', 'running'), job('codex', 'running')];
  const p = createProgress({ output: out, jobs, budgets, now: c.now });
  p.phaseStart('review');
  p.activity(jobs[0].name, { agentIdleMs: STALL_MS + 5_000 });
  p.activity(jobs[1].name, { agentIdleMs: 3_000 });
  const line = statusLine(p.refresh());
  assert.match(line, /grok S3 pass 1\/2 0\/40 calls, no activity 2m05s/);
  assert.match(line, /codex S3 pass 1\/2 0\/40 calls(?!, no activity)/);
  assert.equal(p.refresh().reviewers.find((row) => row.id === 'grok').idleMs, STALL_MS + 5_000);
  // A reviewer that has not started has no idle time, pass or calls.
  const idle = createProgress({ output: temp(), jobs: [job('agy')], budgets }).refresh().reviewers[0];
  assert.deepEqual(Object.keys(idle).sort(), ['id', 'jobs', 'jobsDone', 'passes', 'state']);
});

test('the snapshot carries counts and ids only, and lives in the host-only directory', () => {
  const out = temp();
  const p = createProgress({ output: out, jobs: [job('claude', 'running')], budgets });
  p.phaseStart('review');
  const text = fs.readFileSync(path.join(out, 'harness', 'host', 'progress.json'), 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['elapsedMs', 'percent', 'phase', 'phases', 'reviewers', 'startedAt', 'state', 'updatedAt', 'version']);
  assert.equal(fs.existsSync(path.join(out, 'progress.json')), false);
  assert.equal(readProgress(temp()), null);
});

test('the terminal prints a banner per phase and a status line on change, at most every few seconds', () => {
  const out = temp();
  const c = clock();
  const lines = [];
  const jobs = [job('claude', 'running')];
  const p = createProgress({ output: out, jobs, budgets, now: c.now, print: (line) => lines.push(line), intervalMs: 60_000 });
  p.phaseStart('prepare');
  p.phaseEnd('prepare');
  assert.equal(p.refresh().phase, 'prepare', 'between phases the headline keeps the phase that ended');
  p.phaseStart('review');
  assert.deepEqual(lines, ['\n  ══ Preparing sandbox · 0% · 0s ══', '\n  ══ Review · 10% · 0s ══'], 'one banner per phase, no duplicate status line');
  spend(out, 'claude', 's3:1', 4);
  c.advance(6_000);
  p.refresh();
  assert.equal(lines.length, 2, 'a call count alone is not worth a line');
  passDone(out, 'claude', 1);
  p.refresh();
  assert.equal(lines.length, 3, 'a new pass is');
  assert.match(lines[2], /^  progress 40% · Review · 6s · reviewers done 0\/1 · claude S3 pass 2\/2 0\/40 calls$/);
  spend(out, 'claude', 's3:2', 10);
  c.advance(30_000);
  p.refresh();
  assert.equal(lines.length, 3);
  c.advance(31_000);
  p.refresh();
  assert.equal(lines.length, 4, 'calls are reported in the once-a-minute line');
  assert.match(lines[3], /claude S3 pass 2\/2 10\/40 calls$/);
});

test('tracked phases report skipped, done and failed, and a failure still reaches the runner', async () => {
  const out = temp();
  const p = createProgress({ output: out, jobs: [], budgets });
  const phases = trackPhases([
    { name: 'prepare', run: async () => {} },
    { name: 'debate', run: async () => {}, stub: false },
    { name: 'adjudicate', run: async () => {}, stub: true },
    { name: 'report', run: async () => { throw new Error('boom'); } },
  ], p);
  const ctx = {};
  await phases[0].run(ctx);
  await phases[1].run(ctx);
  await phases[2].run(ctx);
  await assert.rejects(phases[3].run(ctx), /boom/);
  const states = Object.fromEntries(readProgress(out).phases.map((row) => [row.name, row.state]));
  assert.deepEqual([states.prepare, states.debate, states.adjudicate, states.report], ['done', 'skipped', 'skipped', 'failed']);
  // With an orchestrator the debate phase leaves ctx.debate, and it is done.
  const q = createProgress({ output: temp(), jobs: [], budgets });
  await trackPhases([{ name: 'debate', run: async (c) => { c.debate = {}; } }], q)[0].run({});
  assert.equal(q.refresh().phases.find((row) => row.name === 'debate').state, 'done');
});

test('with the status line on, a healthy session prints no heartbeat line and a stalled one does', (t) => {
  const out = temp();
  fs.mkdirSync(path.join(out, 'harness'));
  const printed = [];
  t.mock.method(console, 'log', (line) => printed.push(line));
  const quiet = heartbeatReporter(out, 'grok-s3-logic', { quiet: true });
  quiet({ phase: 'running', elapsedMs: 90_000, agentIdleMs: 5_000 });
  assert.deepEqual(printed, []);
  quiet({ phase: 'running', elapsedMs: 900_000, agentIdleMs: STALL_MS + 1_000 });
  assert.equal(printed.length, 1);
  assert.match(printed[0], /\[grok-s3-logic\] heartbeat: running; running 900s; last agent activity 121s ago/);
  // Without the status line every heartbeat prints, as before; the heartbeat file is written either way.
  heartbeatReporter(out, 'grok-s3-logic')({ phase: 'running', elapsedMs: 30_000, agentIdleMs: 1_000 });
  assert.equal(printed.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'harness', 'heartbeat-grok-s3-logic.json'), 'utf8')).state, 'running');
});

test('non-reviewer sessions are tracked while they run, shown when stalled, and dropped when they end', () => {
  const out = temp();
  const c = clock();
  const p = createProgress({ output: out, jobs: [job('claude')], budgets, now: c.now });
  p.phaseStart('crosscheck');
  p.activity('crosscheck-claude', { agentIdleMs: 4_000 });
  p.activity('codex-debate-cluster-3-r1-devil', { agentIdleMs: STALL_MS + 30_000 });
  p.activity('claude-s3-logic', { agentIdleMs: 1_000 });
  let snap = p.refresh();
  assert.deepEqual(snap.sessions, [{ id: 'crosscheck-claude', idleMs: 4_000 }, { id: 'codex-debate-cluster-3-r1-devil', idleMs: STALL_MS + 30_000 }], 'a reviewer\'s own job is not a session');
  assert.match(statusLine(snap), /codex-debate-cluster-3-r1-devil no activity 2m30s/);
  assert.doesNotMatch(statusLine(snap), /crosscheck-claude no activity/);
  p.sessionEnd('codex-debate-cluster-3-r1-devil');
  snap = p.refresh();
  assert.deepEqual(snap.sessions.map((row) => row.id), ['crosscheck-claude']);
  // A session that stopped sending heartbeats without ending drops out after three intervals.
  c.advance(91_000);
  assert.equal('sessions' in p.refresh(), false);
  p.sessionEnd('crosscheck-claude');
});

test('on a terminal the status is one sticky last row and other lines scroll above it', (t) => {
  const written = [];
  const stream = { isTTY: true, columns: 60, write: (text) => written.push(text) };
  const logged = [];
  const original = { log: console.log, error: console.error };
  t.mock.method(console, 'log', (...args) => logged.push(args.join(' ')));
  const sticky = createSticky({ stream, env: {} });
  try {
    sticky.set('progress 10% · Review');
    assert.deepEqual(written, ['progress 10% · Review']);
    console.log('  -> [claude-s3] auditing S3');
    // The sticky row is cleared, the line is logged, the row is drawn again underneath.
    assert.deepEqual(written.slice(1), ['\r\x1b[2K', 'progress 10% · Review']);
    assert.deepEqual(logged, ['  -> [claude-s3] auditing S3']);
    sticky.set('x'.repeat(200));
    assert.equal(written.at(-1).length, 59, 'a long line is cut to the terminal width');
    assert.ok(written.at(-1).endsWith('…'));
  } finally {
    sticky.end();
  }
  assert.equal(written.at(-1), '\r\x1b[2K', 'the row is cleared when the run ends');
  assert.notEqual(console.log, original.log, 'the mock stays in place (restored by t.mock)');
  const before = written.length;
  console.log('after');
  assert.equal(written.length, before, 'no drawing after end()');
});

test('the sticky line is only for a terminal, replaces status lines, and the final status stays in the scrollback', (t) => {
  assert.equal(createSticky({ stream: { isTTY: false, write() {} } }), null);
  const tty = { isTTY: true, columns: 80, write() {} };
  for (const env of [{ TERM: 'dumb' }, { CI: 'true' }, { OMNISWARM_NO_STICKY: '1' }]) assert.equal(createSticky({ stream: tty, env }), null, JSON.stringify(env));
  const lines = [];
  const rows = [];
  const sticky = { set: (line) => rows.push(line), end: () => rows.push('END') };
  const c = clock();
  const out = temp();
  const p = createProgress({ output: out, jobs: [job('claude', 'running')], budgets, print: (line) => lines.push(line), sticky, now: c.now });
  p.phaseStart('review');
  c.advance(2_000);
  spend(out, 'claude', 's3:1', 5);
  p.refresh();
  assert.ok(rows.length >= 2, 'the sticky row follows every change');
  assert.deepEqual(lines, ['\n  ══ Review · 10% · 0s ══'], 'only the banner is printed while running');
  p.finish('finished');
  assert.equal(rows.at(-1), 'END');
  assert.match(lines.at(-1), /^\n  progress 100% · finished/);
});

test('a phase with no events still ticks: the sticky row redraws with a spinner and the elapsed time', () => {
  const rows = [];
  const sticky = { set: (line) => rows.push(line), end: () => rows.push('END') };
  const c = clock();
  const ticks = [];
  let cleared = null;
  const timer = (fn, ms) => { ticks.push({ fn, ms }); return { id: 'tick', unref() {} }; };
  const p = createProgress({ output: temp(), jobs: [job('claude', 'pending')], budgets, sticky, now: c.now, timer, clearTimer: (id) => { cleared = id; } });
  p.refresh();
  p.phaseStart('prepare');
  assert.match(rows.at(-1), /Preparing sandbox · 0s/, 'a phase start redraws the row at once, even within a second of the last one');
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].ms, 1_000);
  c.advance(7_000);
  ticks[0].fn();
  c.advance(1_000);
  ticks[0].fn();
  const [a, b] = rows.slice(-2);
  assert.match(a, /^\S progress 0% · Preparing sandbox · 7s/);
  assert.match(b, /^\S progress 0% · Preparing sandbox · 8s/);
  assert.notEqual(a[0], b[0], 'the spinner frame moves');
  p.finish('failed');
  assert.equal(cleared.id, 'tick', 'finish stops the ticker');
  const before = rows.length;
  ticks[0].fn();
  assert.equal(rows.length, before, 'no redraw after the run ended');
});

test('without a sticky row the ticker still prints the once-an-interval status line', () => {
  const lines = [];
  const c = clock();
  const ticks = [];
  const p = createProgress({ output: temp(), jobs: [job('claude', 'pending')], budgets, print: (line) => lines.push(line), now: c.now, timer: (fn, ms) => { ticks.push({ fn, ms }); return null; } });
  p.phaseStart('prepare');
  assert.equal(ticks[0].ms, 5_000);
  c.advance(30_000);
  ticks[0].fn();
  assert.equal(lines.length, 1, 'no line before the interval');
  c.advance(30_000);
  ticks[0].fn();
  assert.match(lines.at(-1), /^  progress 0% · Preparing sandbox · 1m00s/);
});

test('the sticky row cuts the activity note to the terminal width instead of chopping the line', () => {
  const rows = [];
  const sticky = { width: 70, set: (l) => rows.push(l), end() {} };
  const c = clock();
  const p = createProgress({ output: temp(), jobs: [job('claude', 'pending')], budgets, sticky, now: c.now, tickMs: 0 });
  p.phaseStart('prepare');
  p.detail('npm-install.log 10s ago');
  c.advance(2_000);
  p.refresh();
  assert.ok(rows.at(-1).length <= 68, rows.at(-1));
  assert.match(rows.at(-1), /^\S progress 0% · Preparing sandbox · \d+s · reviewers done 0\/1/, 'the status part is never cut');
  sticky.width = 200;
  c.advance(2_000);
  p.refresh();
  assert.match(rows.at(-1), /npm-install\.log 10s ago$/);
});
