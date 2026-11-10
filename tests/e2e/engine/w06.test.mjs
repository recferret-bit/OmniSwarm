import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPanel } from '../../../engine/eval/panel.mjs';
import { resultsBody, writeResults } from '../../../engine/eval/results.mjs';
import { loadPhases, runPhases } from '../../../engine/scripts/orchestrator-phases.mjs';
import { SCRIPTS, builtinWithReport, phaseContext, runFromPanel, tempDir } from '../../../engine/scripts/debate-test-run.mjs';
import { writeText } from '../../../engine/scripts/report-util-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GOLDEN = path.join(ROOT, 'engine', 'eval', 'golden', 'near-escrow');
const expected = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'expected.json'), 'utf8'));
const node = (script, args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { cwd: ROOT, encoding: 'utf8' });
const json = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));

// A finalized run with the scripted panel's real submissions on near-escrow, then the orchestrator's phases.
async function orchestrated(rounds) {
  const panel = await runPanel(GOLDEN, expected, tempDir('w06-panel-'));
  const { out, reviewers } = runFromPanel(panel);
  writeText(out, 'harness/sandbox.md', '# Sandbox\n| fixture | impossible | Benign data fixture, no target execution. |\n');
  const ctx = phaseContext({ out, reviewers, target: GOLDEN, orchestrator: 'scripted:judge', rounds });
  await runPhases(await loadPhases({ builtin: builtinWithReport(out), dir: SCRIPTS }), ctx);
  return { out, ctx };
}

test('the plan prints the orchestrator, debate rounds and the cluster cap', () => {
  const result = spawnSync(path.join(ROOT, 'bin', 'audit'), ['run', '--repo', 'engine/eval/golden/near-escrow', '--reviewers', 'scripted:baseline,scripted:paranoid,scripted:wrong,scripted:lazy', '--orchestrator', 'recommended', '--surface', 's1', '--plan'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, OMNI_DEMO: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /debate rounds 2 \(max 3\)/);
  assert.match(result.stdout, /debate cluster cap 25/);
  assert.match(result.stdout, /Orchestrator: recommended/);
});

test('an orchestrated scripted run debates its own clusters in priority order and the report shows the outcome', async () => {
  const { out, ctx } = await orchestrated(2);
  assert.deepEqual(ctx.stageFailures, []);
  const { clusters } = json(out, 'debate/clusters.json');
  const queued = clusters.filter((c) => c.status === 'QUEUED');
  assert.deepEqual(queued.map((c) => c.priority), [...queued.map((c) => c.priority)].sort((a, b) => b - a));
  assert.equal(fs.existsSync(path.join(out, 'debate', 'round-3')), false);
  const rounds = fs.readdirSync(path.join(out, 'debate'), { recursive: true }).filter((rel) => /^round-\d\/.+\.json$/.test(rel)).map((rel) => fs.readFileSync(path.join(out, 'debate', rel), 'utf8')).join('\n');
  assert.equal(/scripted-|baseline|paranoid|glm|claude/.test(rounds), false);
  for (const row of json(out, 'debate/adjudication.json')) assert.deepEqual(row.judge, { reviewerId: 'scripted-judge', vendor: 'scripted', alternate: false });
  // The fixture run has no cross-check round, so the report is INCOMPLETE for that reason only.
  const rendered = node('generate-html-report.mjs', [out]);
  assert.ok(rendered.status === 0 || rendered.status === 2, rendered.stderr);
  assert.deepEqual(json(out, 'report-health.json').errors.filter((e) => !/cross-check (output|exit)/.test(e)), []);
  const scored = json(out, 'findings-and-scores.json');
  for (const bug of expected.bugs) assert.equal(scored.find((row) => row.locations.includes(`${bug.file}:${bug.startLine}`)).finalStatus, 'LIKELY');
  const html = fs.readFileSync(path.join(out, 'report.html'), 'utf8');
  assert.match(html, /<summary>Debate<\/summary>/);
  assert.match(html, /data-status="REFUTED"/);
  assert.match(html, /05<\/span>Cross-check/);
  assert.match(html, /Model agreement and passing checks do not certify security\./);
  for (const id of ['scripted-baseline', 'scripted-paranoid', 'scripted-wrong', 'scripted-lazy']) assert.ok(fs.existsSync(path.join(out, 'reviewers', id, 'report.html')), id);
});

test('with three rounds allowed, a cluster whose author only conceded is not rebutted', async () => {
  const { out, ctx } = await orchestrated(3);
  assert.deepEqual(ctx.stageFailures, []);
  // The scripted authors concede or repeat their own line; neither is new evidence, so no challenger rebuts.
  // The positive case (a defence with a fresh citation opens round 3) is in engine/scripts/debate-rules.test.mjs.
  const round2 = fs.readdirSync(path.join(out, 'debate', 'round-2')).map((name) => json(out, `debate/round-2/${name}`));
  assert.ok(round2.length > 0);
  assert.ok(round2.some((turn) => turn.conformitySuspect), 'a concession that cites only known lines is flagged');
  assert.equal(fs.existsSync(path.join(out, 'debate', 'round-3')), false);
});

test('a debate-round-2 fault marks the run INCOMPLETE and keeps every per-model finding', async (t) => {
  process.env.OMNI_FAULT = 'debate-round-2';
  t.after(() => { delete process.env.OMNI_FAULT; });
  const { out, ctx } = await orchestrated(2);
  assert.ok(ctx.stageFailures.some((s) => s.startsWith('phase_failed:debate:')), ctx.stageFailures.join());
  assert.equal(fs.existsSync(path.join(out, 'debate')), false);
  const checked = node('report-contract.mjs', [out]);
  assert.equal(checked.status, 2);
  assert.match(checked.stderr, /One or more review stages failed/);
  node('generate-html-report.mjs', [out]);
  assert.equal(json(out, 'report-health.json').state, 'incomplete');
  assert.ok(json(out, 'findings-and-scores.json').length >= expected.bugs.length);
  assert.match(fs.readFileSync(path.join(out, 'report.html'), 'utf8'), /withdraw has no owner check/);
});

test('eval RESULTS.md is rewritten only when its numbers change, and each run is recorded under eval/runs', () => {
  const dir = tempDir('w06-results-');
  const file = path.join(dir, 'RESULTS.md');
  const runsDir = path.join(dir, 'runs');
  const body = '| repo | mode | recall |\n|---|---|---:|\n| a | union | 1 |\n';
  assert.deepEqual(writeResults({ file, runsDir, body, date: '2026-01-01', commit: 'aaaaaaa' }), { changed: true });
  const first = fs.readFileSync(file, 'utf8');
  assert.match(first, /date 2026-01-01 · commit aaaaaaa/);
  assert.equal(resultsBody(first), body);
  // Same numbers on another day and commit: the committed file keeps its bytes; the run is recorded on the side.
  assert.deepEqual(writeResults({ file, runsDir, body, date: '2026-02-02', commit: 'bbbbbbb' }), { changed: false });
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  assert.deepEqual(json(runsDir, 'last-run.json'), { date: '2026-02-02', commit: 'bbbbbbb', resultsChanged: false });
  // Changed numbers: the new table carries the date and commit it was measured at.
  assert.deepEqual(writeResults({ file, runsDir, body: body.replace('| 1 |', '| 0.5 |'), date: '2026-03-03', commit: 'ccccccc' }), { changed: true });
  assert.match(fs.readFileSync(file, 'utf8'), /date 2026-03-03 · commit ccccccc[\s\S]*\| a \| union \| 0\.5 \|/);
});

test('the committed eval RESULTS.md has the deterministic header the runner compares against', () => {
  const committed = fs.readFileSync(path.join(ROOT, 'engine', 'eval', 'RESULTS.md'), 'utf8');
  assert.notEqual(resultsBody(committed), null);
  assert.match(resultsBody(committed), /^Reviewers: scripted:/);
});
