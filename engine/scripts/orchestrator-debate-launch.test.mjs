// The debate on the Docker path: runOrchestratedAudit with a stand-in session (no Docker, no provider) whose
// debate and judge turns go through the real bridge start-up (parseBridgeArgs + attachBudget) and dispatch
// (callBridgeTool, REVIEW_TOOLS). The orchestrator is not one of the run's reviewers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runOrchestratedAudit } from './docker-agent-orchestrator.mjs';
import { commitSubmission, validateSubmissionIdentity } from './audit-submission.mjs';
import { attachBudget } from './bridge-budget.mjs';
import { callBridgeTool, parseBridgeArgs } from './docker-mcp-bridge.mjs';
import { readReportJson } from './report-contract.mjs';
import { parseReviewerList, parseReviewerSpec } from './reviewer-registry.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';

const [ZAI, QWEN] = parseReviewerList(['key:zai:glm-5.3', 'openrouter:qwen/qwen3.8-max-0902']);
const JUDGE = parseReviewerSpec('openrouter:anthropic/claude-opus-5.5');
const BUDGETS = { passes: 1, toolBudget: 5, maxCostUsd: null, debate: { rounds: 2, toolBudget: 4, maxClusters: 25 } };
const CITE = { file: 'src/lib.rs', startLine: 30, endLine: 30, quote: 'let next = self.balance.saturating_sub(amount);' };
const WITHDRAW = {
  title: 'Missing owner check in withdraw', surface: 'S1', severity: 'high', confidence: 'probable', location: ['src/lib.rs:30'],
  impact: 'Any caller lowers the balance.', preconditions: 'None.', analysis: 'withdraw never reads the predecessor (src/lib.rs:30).',
  validation: 'Source inspection.', attack: [], poc: '', fix: 'Compare the predecessor with the owner.',
};
const arg = (args, name) => args[args.indexOf(name) + 1];
const ok = (identity, options) => ({ code: 0, stop: 'submitted', sessionId: identity.name, directory: options.directory, elapsedMs: 1, observedExitCode: 0 });

function answer(role, assignment) {
  if (role === 'debater') return ['submit_debate_turn', { verdict: 'upheld', citations: [CITE], argument: 'withdraw has no owner comparison before the balance changes.' }];
  if (assignment.kind === 'judge') return ['submit_adjudication', { finalStatus: 'CONFIRMED', severity: 'high', rationale: 'An independent reviewer upheld it with the cited line.' }];
  return ['submit_general_review', { report_json: JSON.stringify({ executiveSummary: 'One confirmed access-control finding.', openDisagreements: [] }) }];
}

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-debate-launch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const review = async (options) => {
    const { identity, bridgeArgs, budgets } = options;
    const out = arg(bridgeArgs, '--report-dir');
    calls.push({ identity, bridgeArgs, budgets });
    if (identity.role === 'auditor') {
      // What the API shim records for a priced reviewer; the other reviewer reports no cost at all.
      if (identity.agent === ZAI.id) {
        fs.mkdirSync(path.join(options.directory, 'workspace'), { recursive: true });
        fs.writeFileSync(path.join(options.directory, 'workspace', 'api-session.json'), JSON.stringify({ usage: [{ prompt_tokens: 7, completion_tokens: 3, cost: 0.02, costSource: 'estimated' }] }));
      }
      commitSubmission(out, identity.name, identity, [...(identity.agent === ZAI.id ? [WITHDRAW] : []), { verified_safe: [] }]);
      return ok(identity, options);
    }
    if (identity.role === 'crosscheck') {
      commitSubmission(out, identity.name, identity, readReportJson(out, `crosscheck/${identity.agent}.json`).map((row) => ({ id: row.id, verdict: 'upheld', reason: 'Cited line read.', evidence: ['src/lib.rs:30'] })));
      return ok(identity, options);
    }
    // The bridge a debate or judge session starts, served from the bundled fixture instead of a container.
    const ctx = attachBudget(parseBridgeArgs([...bridgeArgs, '--demo-host', DEMO_FIXTURE]));
    assert.match(await callBridgeTool(ctx, 'read_file', { path: 'src/lib.rs' }), /saturating_sub/);
    const [tool, args] = answer(identity.role, readReportJson(out, `harness/assignments/${identity.name}.json`));
    await callBridgeTool(ctx, tool, args);
    return ok(identity, options);
  };
  const startSandbox = async ({ out }) => ({ container: 'inert', hostRunDir: out, stop: async () => {} });
  // The vault source only: the fixture's catalogued suites (client tests, NEAR build checks) need a real container.
  const target = path.join(root, 'target');
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.copyFileSync(path.join(DEMO_FIXTURE, 'src/lib.rs'), path.join(target, 'src/lib.rs'));
  const request = { target, out: path.join(root, 'report'), surface: 's1', reviewers: [ZAI, QWEN], orchestrator: JUDGE, budgets: BUDGETS };
  return { calls, review, startSandbox, request };
}

test('debate turns, the judge and the general review launch through the bridge; the judge need not be a reviewer', async (t) => {
  const f = setup(t);
  const result = await runOrchestratedAudit(f.request, { review: f.review, startSandbox: f.startSandbox });
  assert.deepEqual(result.stageFailures, []);
  const out = f.request.out;
  const names = f.calls.filter((c) => ['debater', 'orchestrator'].includes(c.identity.role)).map((c) => c.identity.name);
  // The challenger already upheld the claim in the cross-check phase with a citable line, so its round-1 turn is
  // that verdict and no second session asks for it. The devil's advocate turn, the judge and the review do launch.
  assert.deepEqual(names, [`${QWEN.id}-debate-cluster-1-r1-devil`, `${JUDGE.id}-judge-cluster-1`, `${JUDGE.id}-general-review`]);
  const trace = fs.readFileSync(path.join(out, 'debate', 'trace.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(trace.filter((row) => row.template === 'challenge').map((row) => [row.verdict, row.stop, row.source]), [['upheld', 'kept', 'crosscheck']]);
  const roundOne = fs.readdirSync(path.join(out, 'debate', 'round-1')).map((name) => readReportJson(out, `debate/round-1/${name}`));
  assert.deepEqual(roundOne.find((turn) => turn.role === 'challenge').citations, [CITE], 'the quote is the cited line read from the snapshot');
  const judgeCall = f.calls.find((c) => c.identity.name === `${JUDGE.id}-judge-cluster-1`);
  assert.equal(arg(judgeCall.bridgeArgs, '--auditor'), judgeCall.identity.name);
  assert.equal(judgeCall.identity.model, JUDGE.model);
  assert.equal(judgeCall.budgets.toolBudget, BUDGETS.debate.toolBudget, 'debate and judge sessions receive the debate toolBudget');
  assert.deepEqual(readReportJson(out, 'harness/reviewers.json').judges.map((j) => j.id), [JUDGE.id]);
  const [row] = readReportJson(out, 'debate/adjudication.json');
  assert.deepEqual([row.finalStatus, row.judge.reviewerId, row.judge.alternate], ['CONFIRMED', JUDGE.id, false]);
  const general = readReportJson(out, 'general-review.json');
  assert.equal(general.executiveSummary, 'Adjudicated: 1 cluster, 1 CONFIRMED; by severity 1 high. One confirmed access-control finding.');
  // A cost is shown only where a pass priced it; an unpriced reviewer is null, not a fabricated 0.
  assert.deepEqual(general.contributions.map((row) => [row.reviewerId, row.costUsd]), [[ZAI.id, 0.02], [QWEN.id, null]]);
  for (const name of names) {
    assert.ok(readReportJson(out, `harness/bridge-${name}.json`).some((e) => e.tool.startsWith('submit_')), name);
    assert.equal(readReportJson(out, `harness/debate-budget-${name}.json`).calls, 1, `${name}: the read counts against the debate budget`);
  }
  // Debate sessions never draw on (or get blocked by) a reviewer's per-pass budget. Only they used the real
  // bridge here, so no per-pass budget file exists at all.
  for (const id of [QWEN.id, JUDGE.id]) assert.equal(fs.existsSync(path.join(out, 'harness', `budget-${id}.json`)), false, id);
  // The live progress snapshot ends finished at 100%, with every phase accounted for and the debate counted.
  const progress = readReportJson(out, 'harness/host/progress.json');
  assert.deepEqual([progress.state, progress.percent, progress.phase], ['finished', 100, 'report']);
  assert.deepEqual(progress.phases.map((row) => [row.name, row.state]), [['prepare', 'done'], ['tests', 'done'], ['review', 'done'], ['crosscheck', 'done'], ['debate', 'done'], ['adjudicate', 'done'], ['general-review', 'done'], ['report', 'done']]);
  assert.deepEqual(progress.debate, { clusters: 1, heard: 1, judged: 1, toJudge: 1 });
  assert.deepEqual(progress.crosscheck, { done: 2, total: 2 });
  assert.deepEqual(progress.reviewers.map((row) => [row.id, row.state, row.jobsDone, row.jobs]), [[ZAI.id, 'done', 1, 1], [QWEN.id, 'done', 1, 1]]);
});

test('the bridge admits a judge only in the orchestrator role, under its own session names', async (t) => {
  const f = setup(t);
  await runOrchestratedAudit(f.request, { review: f.review, startSandbox: f.startSandbox });
  const out = f.request.out;
  const judgeArgs = f.calls.find((c) => c.identity.name === `${JUDGE.id}-judge-cluster-1`).bridgeArgs;
  const asDebater = judgeArgs.map((value) => (value === 'orchestrator' ? 'debater' : value));
  assert.throws(() => parseBridgeArgs(asDebater), (error) => error.code === 'IDENTITY_UNKNOWN');
  const identity = readReportJson(out, `harness/identities/${JUDGE.id}-judge-cluster-1.json`);
  for (const [role, name] of [['debater', `${JUDGE.id}-judge-cluster-1`], ['orchestrator', `${JUDGE.id}-debate-cluster-1-r1`], ['orchestrator', `${JUDGE.id}-s1-auth`], ['auditor', `${JUDGE.id}-general-review`]]) {
    assert.throws(() => validateSubmissionIdentity({ ...identity, role, name }, name), /Submission reviewer mismatch/, `${role} ${name}`);
  }
  for (const name of [`${JUDGE.id}-judge-cluster-0`, `${JUDGE.id}-debate-cluster-1-r4`, `${JUDGE.id}-general-review-2`]) {
    assert.throws(() => validateSubmissionIdentity({ ...identity, name }, name), /Invalid submission identity/, name);
  }
  assert.throws(() => commitSubmission(out, identity.name, identity, []), /debate inbox/);
});

test('a crosscheck missing_report failure does not poison providerFailures or block debate, adjudicate or general-review, and crosscheck scales toolBudget with peer claims', async (t) => {
  const f = setup(t);
  const manyClaims = Array.from({ length: 45 }, (_, i) => ({
    ...WITHDRAW, title: `Finding ${i + 1}`, location: [`src/lib.rs:${(i % 20) + 1}`],
  }));
  const review = async (options) => {
    if (options.identity.role === 'auditor' && options.identity.agent === ZAI.id) {
      const out = arg(options.bridgeArgs, '--report-dir');
      f.calls.push({ identity: options.identity, bridgeArgs: options.bridgeArgs, budgets: options.budgets });
      commitSubmission(out, options.identity.name, options.identity, [...manyClaims, { verified_safe: [] }]);
      return ok(options.identity, options);
    }
    if (options.identity.role === 'crosscheck') {
      f.calls.push({ identity: options.identity, bridgeArgs: options.bridgeArgs, budgets: options.budgets });
      return { code: 0, stop: 'budget', stopReason: 'cancelled', sessionId: options.identity.name, directory: options.directory, elapsedMs: 1, observedExitCode: 0 };
    }
    return f.review(options);
  };
  const result = await runOrchestratedAudit(f.request, { review, startSandbox: f.startSandbox });
  assert.deepEqual(result.stageFailures, [`crosscheck_error:${QWEN.id}`]);
  const out = f.request.out;
  // A run with a stage failure finishes its report but is not shown as done.
  const progress = readReportJson(out, 'harness/host/progress.json');
  assert.equal(progress.state, 'incomplete');
  assert.ok(progress.percent < 100);
  const meta = readReportJson(out, 'meta.json');
  assert.equal(meta.crosscheckExits[QWEN.id], 1);
  assert.deepEqual(meta.providerFailures, {}, 'missing_report on crosscheck must not poison providerFailures');
  const xcheckCall = f.calls.find((c) => c.identity.role === 'crosscheck' && c.identity.agent === QWEN.id);
  assert.equal(xcheckCall.budgets.toolBudget, 65, 'crosscheck toolBudget scales to claimCount (45) + 20');
  assert.equal(Number(arg(xcheckCall.bridgeArgs, '--tool-budget')), 65);
  const debateAndJudge = f.calls.filter((c) => ['debater', 'orchestrator'].includes(c.identity.role)).map((c) => c.identity.name);
  assert.ok(debateAndJudge.includes(`${QWEN.id}-debate-cluster-1-r1`), 'reviewer with crosscheck missing_report still participates in debate');
  assert.ok(debateAndJudge.includes(`${JUDGE.id}-judge-cluster-1`), 'judge still runs adjudication');
  assert.ok(debateAndJudge.includes(`${JUDGE.id}-general-review`), 'orchestrator still runs general-review');
});
