import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPanel } from '../../../engine/eval/panel.mjs';
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

test('three rounds rebut only after a change and flag copied flips', async () => {
  const { out } = await orchestrated(3);
  const round3 = fs.readdirSync(path.join(out, 'debate', 'round-3')).map((name) => json(out, `debate/round-3/${name}`));
  assert.ok(round3.length > 0);
  const changed = new Set(fs.readdirSync(path.join(out, 'debate', 'round-2')).map((name) => json(out, `debate/round-2/${name}`)).filter((t) => t.verdict !== 'upheld').map((t) => t.clusterId));
  assert.ok(round3.every((turn) => changed.has(turn.clusterId)));
  assert.ok(round3.some((turn) => turn.conformitySuspect));
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
