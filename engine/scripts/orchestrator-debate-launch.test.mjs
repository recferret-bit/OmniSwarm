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
    const { identity, bridgeArgs } = options;
    const out = arg(bridgeArgs, '--report-dir');
    calls.push({ identity, bridgeArgs });
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
  const request = { target: DEMO_FIXTURE, out: path.join(root, 'report'), surface: 's1', reviewers: [ZAI, QWEN], orchestrator: JUDGE, budgets: BUDGETS };
  return { calls, review, startSandbox, request };
}

test('debate turns, the judge and the general review launch through the bridge; the judge need not be a reviewer', async (t) => {
  const f = setup(t);
  const result = await runOrchestratedAudit(f.request, { review: f.review, startSandbox: f.startSandbox });
  assert.deepEqual(result.stageFailures, []);
  const out = f.request.out;
  const names = f.calls.filter((c) => ['debater', 'orchestrator'].includes(c.identity.role)).map((c) => c.identity.name);
  assert.deepEqual(names, [`${QWEN.id}-debate-cluster-1-r1`, `${JUDGE.id}-judge-cluster-1`, `${JUDGE.id}-general-review`]);
  const judgeCall = f.calls.find((c) => c.identity.name === `${JUDGE.id}-judge-cluster-1`);
  assert.equal(arg(judgeCall.bridgeArgs, '--auditor'), judgeCall.identity.name);
  assert.equal(judgeCall.identity.model, JUDGE.model);
  assert.deepEqual(readReportJson(out, 'harness/reviewers.json').judges.map((j) => j.id), [JUDGE.id]);
  const [row] = readReportJson(out, 'debate/adjudication.json');
  assert.deepEqual([row.finalStatus, row.judge.reviewerId, row.judge.alternate], ['CONFIRMED', JUDGE.id, false]);
  const general = readReportJson(out, 'general-review.json');
  assert.equal(general.executiveSummary, 'One confirmed access-control finding.');
  // A cost is shown only where a pass priced it; an unpriced reviewer is null, not a fabricated 0.
  assert.deepEqual(general.contributions.map((row) => [row.reviewerId, row.costUsd]), [[ZAI.id, 0.02], [QWEN.id, null]]);
  for (const name of names) {
    assert.ok(readReportJson(out, `harness/bridge-${name}.json`).some((e) => e.tool.startsWith('submit_')), name);
    assert.equal(readReportJson(out, `harness/debate-budget-${name}.json`).calls, 1, `${name}: the read counts against the debate budget`);
  }
  // Debate sessions never draw on (or get blocked by) a reviewer's per-pass budget. Only they used the real
  // bridge here, so no per-pass budget file exists at all.
  for (const id of [QWEN.id, JUDGE.id]) assert.equal(fs.existsSync(path.join(out, 'harness', `budget-${id}.json`)), false, id);
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
