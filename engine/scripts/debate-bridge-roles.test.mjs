import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sha256Json as digest } from './hash-util.mjs';
import { bridgeRole } from './bridge-tools-registry.mjs';
import { callBridgeTool } from './docker-mcp-bridge.mjs';
import { acceptGeneralReview } from './bridge-tools-orchestrator.mjs';
import { readInbox } from './debate-inbox.mjs';
import { writeJson } from './report-util-files.mjs';
import { sourceTree, tempDir } from './debate-test-run.mjs';

const QUOTE = { file: 'src/lib.rs', startLine: 2, endLine: 2, quote: 'balance -= amount;' };

function session(role, name, assignment) {
  const reportDir = tempDir('bridge-debate-');
  writeJson(reportDir, `harness/assignments/${name}.json`, assignment);
  const demoHost = sourceTree({ 'src/lib.rs': 'fn withdraw() {\n    balance -= amount;\n}\n' });
  return { role, reportDir, demoHost, agent: 'cli-codex-gpt-5-5', surface: 'ALL', submissionIdentity: { name, agent: 'cli-codex-gpt-5-5', role, assignmentDigest: digest(assignment) } };
}

const turnTask = { kind: 'debate-turn', clusterId: 'CLUSTER-1', round: 1, role: 'devil', anonId: 'Reviewer B', budget: 3 };

test('every tool a debate role advertises has a handler, and the read schemas are the auditor ones', () => {
  const auditor = Object.fromEntries(bridgeRole('auditor').toolDefinitions().map((tool) => [tool.name, tool.inputSchema]));
  for (const role of ['debater', 'orchestrator']) {
    const mod = bridgeRole(role);
    for (const tool of mod.toolDefinitions()) {
      assert.equal(typeof mod.handlers[tool.name], 'function', `${role} ${tool.name}`);
      if (auditor[tool.name]) assert.deepEqual(tool.inputSchema, auditor[tool.name], `${role} ${tool.name}`);
    }
    assert.equal(mod.toolDefinitions().some((tool) => tool.name === 'run_existing_tests'), false);
  }
});

test('debater reads go through callBridgeTool and stop at the assignment budget', async () => {
  const ctx = session('debater', 'cli-codex-gpt-5-5-debate-cluster-1-r1', turnTask);
  for (let i = 0; i < 3; i++) assert.match(await callBridgeTool(ctx, 'read_file', { path: 'src/lib.rs' }), /balance -= amount/);
  assert.match(await callBridgeTool(ctx, 'read_file', { path: 'src/lib.rs' }), /budget exhausted: call submit_debate_turn now/);
});

test('a debate turn is schema-checked, needs a citation, takes its labels from the assignment and commits once', async () => {
  const ctx = session('debater', 'cli-codex-gpt-5-5-debate-cluster-1-r1', turnTask);
  const submit = bridgeRole('debater').handlers.submit_debate_turn;
  await assert.rejects(submit(ctx, { verdict: 'refuted', citations: [], argument: 'no' }), /citation_required/);
  await assert.rejects(submit(ctx, { verdict: 'secure', citations: [QUOTE], argument: 'x' }), /Invalid debate turn/);
  await submit(ctx, { report_json: JSON.stringify({ verdict: 'refuted', citations: [QUOTE], argument: 'The guard holds.', round: 3, anonId: 'Reviewer Z' }) });
  const body = readInbox(ctx.reportDir, ctx.submissionIdentity.name, 'debate-turn');
  assert.deepEqual([body.round, body.anonId, body.role, body.devilAdvocate], [1, 'Reviewer B', 'devil', true]);
  await assert.rejects(submit(ctx, { verdict: 'upheld', citations: [QUOTE], argument: 'again' }), /duplicate_submit/);
  const file = path.join(ctx.reportDir, 'debate', 'inbox', `${ctx.submissionIdentity.name}.json`);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...stored, body: { ...stored.body, verdict: 'upheld' } }));
  assert.throws(() => readInbox(ctx.reportDir, ctx.submissionIdentity.name, 'debate-turn'), /does not match its hash/);

  const aliasCtx = session('debater', 'cli-codex-gpt-5-5-debate-cluster-1-r2', { ...turnTask, round: 2, role: 'defend' });
  await submit(aliasCtx, { verdict: 'upheld', evidence: [{ file: 'src/lib.rs', line: 2, quote: 'balance -= amount;' }], reason: 'Single-line evidence alias.' });
  const normalized = readInbox(aliasCtx.reportDir, aliasCtx.submissionIdentity.name, 'debate-turn');
  assert.deepEqual(normalized.citations, [QUOTE]);
  assert.equal(normalized.argument, 'Single-line evidence alias.');
});

test('a session cannot submit for a different assignment or role', async () => {
  const ctx = session('debater', 'cli-codex-gpt-5-5-debate-cluster-1-r1', turnTask);
  writeJson(ctx.reportDir, `harness/assignments/${ctx.submissionIdentity.name}.json`, { ...turnTask, clusterId: 'CLUSTER-7' });
  await assert.rejects(bridgeRole('debater').handlers.submit_debate_turn(ctx, { verdict: 'upheld', citations: [QUOTE], argument: 'x' }), /does not match the session identity/);
  const judge = session('debater', 'cli-codex-gpt-5-5-judge-cluster-1', { kind: 'judge', clusterId: 'CLUSTER-1' });
  await assert.rejects(bridgeRole('orchestrator').handlers.submit_adjudication(judge, { finalStatus: 'LIKELY', severity: 'high', rationale: 'r' }), /outside the orchestrator bridge role/);
});

test('the orchestrator commits a schema-valid judgement and a general review with no new findings', async () => {
  const judgeTask = { kind: 'judge', clusterId: 'CLUSTER-1', judge: { reviewerId: 'cli-codex-gpt-5-5', vendor: 'openai', alternate: true }, validArguments: ['Reviewer A round 1: upheld'], discardedArguments: [] };
  const judge = session('orchestrator', 'cli-codex-gpt-5-5-judge-cluster-1', judgeTask);
  const handlers = bridgeRole('orchestrator').handlers;
  await assert.rejects(handlers.submit_adjudication(judge, { finalStatus: 'SECURE', severity: 'high', rationale: 'r' }), /Invalid adjudication/);
  await handlers.submit_adjudication(judge, { finalStatus: 'LIKELY', severity: 'medium', severityReason: 'Needs a caller.', rationale: 'One upheld argument.' });
  const row = readInbox(judge.reportDir, judge.submissionIdentity.name, 'judge');
  assert.deepEqual(row.judge, judgeTask.judge);
  const review = session('orchestrator', 'cli-codex-gpt-5-5-general-review', { kind: 'general-review', clusterIds: ['CLUSTER-1'] });
  await assert.rejects(handlers.submit_general_review(review, { executiveSummary: 's', openDisagreements: [{ clusterId: 'CLUSTER-9', summary: 'new' }] }), /new_finding_in_general_review/);
  await handlers.submit_general_review(review, { executiveSummary: 'One likely issue.', openDisagreements: [{ clusterId: 'CLUSTER-1', summary: 'open' }] });
  assert.equal(readInbox(review.reportDir, review.submissionIdentity.name, 'general-review').executiveSummary, 'One likely issue.');
  assert.throws(() => acceptGeneralReview({ topFindings: [{ clusterId: 'NOPE' }] }, ['CLUSTER-1']), /new_finding_in_general_review/);
});
