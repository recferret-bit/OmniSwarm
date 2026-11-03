import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPhases, runPhases } from './orchestrator-phases.mjs';
import { BUILTIN, SCRIPTS, fakeExecute, finding, phaseContext, reportRun, sourceTree } from './debate-test-run.mjs';

// The audit's two reproductions used a target that does, and one that does not, contain these strings.
const BAIT = { 'src/lib.rs': 'pub fn deposit() {\n    assert_eq!(caller, owner);\n}\npub fn withdraw(a: u128) {\n    balance = balance.saturating_sub(a);\n}\n' };
const PLAIN = { 'src/main.ts': 'export function handler(req) {\n  return db.query(req.body.sql);\n}\n' };

async function runAll(ctx) {
  await runPhases(await loadPhases({ builtin: BUILTIN, dir: SCRIPTS }), ctx);
  return ctx;
}

const readTree = (dir) => fs.readdirSync(dir, { recursive: true }).filter((rel) => fs.statSync(path.join(dir, rel)).isFile()).map((rel) => fs.readFileSync(path.join(dir, rel), 'utf8')).join('\n');

test('a real target with saturating_sub and assert_eq! gets no fabricated finding or reviewer', async () => {
  const { out, reviewers } = reportRun(['cli:claude:opus', 'cli:codex:gpt-5.5']);
  const ctx = await runAll(phaseContext({ out, reviewers, target: sourceTree(BAIT), orchestrator: 'cli:claude:opus' }));
  const written = readTree(out);
  assert.equal(written.includes('Missing owner check'), false);
  assert.equal(/scripted-(baseline|paranoid|wrong|lazy)/.test(written), false);
  const general = JSON.parse(fs.readFileSync(path.join(out, 'general-review.json'), 'utf8'));
  assert.deepEqual(general.topFindings, []);
  assert.equal(general.riskPosture, 'low-observed');
  assert.deepEqual(ctx.stageFailures, []);
});

test('a real target without those strings does not throw and debates the committed claim', async () => {
  const sql = finding('SQL from the request body', ['src/main.ts:2']);
  const { out, reviewers } = reportRun(['cli:claude:opus', 'cli:codex:gpt-5.5'], { 'cli-claude-opus': { findings: [sql] } });
  const ctx = await runAll(phaseContext({ out, reviewers, target: sourceTree(PLAIN), orchestrator: 'cli:claude:opus' }));
  const clusters = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'clusters.json'), 'utf8')).clusters;
  assert.deepEqual(clusters.map((c) => c.primaryTitle), ['SQL from the request body']);
  assert.equal(ctx.stageFailures.some((s) => s.includes('missing saturating_sub')), false);
  // No model answered (execute fails), so the run is INCOMPLETE and the claim is kept, not dropped.
  assert.ok(ctx.stageFailures.some((s) => s.startsWith('phase_failed:adjudicate:debate_incomplete')), ctx.stageFailures.join());
  const [row] = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'adjudication.json'), 'utf8'));
  assert.equal(row.finalStatus, 'LIKELY');
});

test('scripted:judge on a real target is refused as a stage failure', async () => {
  const { out, reviewers } = reportRun(['cli:claude:opus']);
  const ctx = await runAll(phaseContext({ out, reviewers, target: sourceTree(BAIT), orchestrator: 'scripted:judge' }));
  assert.ok(ctx.stageFailures.some((s) => s.includes('scripted_judge_demo_only')), ctx.stageFailures.join());
  assert.equal(fs.existsSync(path.join(out, 'debate')), false);
  assert.equal(fs.existsSync(path.join(out, 'general-review.json')), false);
});

test('without an orchestrator nothing is debated, even with a fault set', async (t) => {
  process.env.OMNI_FAULT = 'debate-round-2';
  t.after(() => { delete process.env.OMNI_FAULT; });
  const { out, reviewers } = reportRun(['cli:claude:opus']);
  const ctx = await runAll(phaseContext({ out, reviewers, target: sourceTree(BAIT) }));
  assert.equal(fs.existsSync(path.join(out, 'debate')), false);
  assert.deepEqual(ctx.stageFailures.filter((s) => !s.startsWith('phase_failed:reviewer-reports')), []);
});

test('the fault seams throw coded errors and never write meta.json or report-health.json', async (t) => {
  for (const fault of ['debate-round-2', 'general-review']) {
    process.env.OMNI_FAULT = fault;
    const { out, reviewers } = reportRun(['cli:claude:opus', 'cli:codex:gpt-5.5']);
    const before = fs.readFileSync(path.join(out, 'meta.json'), 'utf8');
    const ctx = await runAll(phaseContext({ out, reviewers, target: sourceTree(PLAIN), orchestrator: 'cli:claude:opus' }));
    assert.ok(ctx.stageFailures.some((s) => s.startsWith(`phase_failed:${fault === 'general-review' ? 'general-review' : 'debate'}:injected fault`)), ctx.stageFailures.join());
    assert.equal(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'), before);
    assert.equal(fs.existsSync(path.join(out, 'report-health.json')), false);
  }
  t.after(() => { delete process.env.OMNI_FAULT; });
});

test('model debaters answer through the bridge handlers and the judge must be another vendor', async () => {
  const sql = finding('SQL from the request body', ['src/main.ts:2']);
  const { out, reviewers } = reportRun(['cli:claude:opus', 'cli:codex:gpt-5.5', 'cli:grok:grok-4'], { 'cli-claude-opus': { findings: [sql] } });
  const quote = { file: 'src/main.ts', startLine: 2, endLine: 2, quote: 'return db.query(req.body.sql);' };
  const calls = [];
  const execute = fakeExecute(out, (task, assignment) => {
    if (task.role === 'debater') return { verdict: 'upheld', citations: [quote], argument: 'The body reaches the query unchanged.' };
    if (assignment.kind === 'judge') return { finalStatus: 'CONFIRMED', severity: 'high', rationale: 'Two independent upholds.' };
    return { executiveSummary: 'One confirmed injection.', openDisagreements: [] };
  }, calls);
  const ctx = await runAll(phaseContext({ out, reviewers, target: sourceTree(PLAIN), orchestrator: 'cli:claude:opus', execute }));
  assert.deepEqual(ctx.stageFailures, []);
  const [row] = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'adjudication.json'), 'utf8'));
  assert.equal(row.finalStatus, 'CONFIRMED');
  // The only author is anthropic, so the anthropic orchestrator hands the cluster to the alternate judge.
  assert.equal(row.judge.alternate, true);
  assert.notEqual(row.judge.vendor, 'anthropic');
  assert.ok(calls.some((c) => c.role === 'orchestrator' && c.assignment.kind === 'judge' && c.agent === row.judge.reviewerId));
  const roundOne = fs.readdirSync(path.join(out, 'debate', 'round-1'));
  assert.equal(roundOne.length, 2);
  assert.ok(roundOne.every((name) => /^Reviewer [A-Z]-CLUSTER-1\.json$/.test(name)));
  const general = JSON.parse(fs.readFileSync(path.join(out, 'general-review.json'), 'utf8'));
  assert.equal(general.executiveSummary, 'One confirmed injection.');
  assert.deepEqual(general.topFindings.map((f) => f.finalStatus), ['CONFIRMED']);
});
