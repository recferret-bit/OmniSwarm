// W04 on the Docker path: runOrchestratedAudit with a fake session (no Docker, no provider) must hand the
// session its budgets and prices, run every pass through the shared loop, record usage and budget health,
// keep earlier passes when a later one fails, and resume at the failed pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runOrchestratedAudit } from './docker-agent-orchestrator.mjs';
import { commitSubmission } from './audit-submission.mjs';
import { loadAuditors, readReportJson } from './report-contract.mjs';
import { parseReviewerList } from './reviewer-registry.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';

const BUDGETS = { passes: 2, toolBudget: 5, maxCostUsd: 2, debate: { rounds: 2, toolBudget: 12, maxClusters: 25 } };
const PRICES = { zai: { 'glm-5.3': { inPerMTok: 1, outPerMTok: 2 } } };

function finding(identity, pass) {
  return [{ title: `Pass ${pass} finding ${identity.name}`, surface: identity.surface, severity: 'low', confidence: 'probable', location: ['source.js:1'], impact: 'Fixture only', preconditions: 'Inert fixture', analysis: 'Inspected source.js:1', validation: 'No target execution', attack: [], poc: '', fix: 'Fixture guidance' }, { verified_safe: [] }];
}

function setup(t, { target, failPass = null, reviewers = ['scripted:baseline'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-passes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let source = target;
  if (!source) {
    source = path.join(root, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'source.js'), 'export const inert = true;\n');
  }
  const calls = [];
  const review = async (options) => {
    const { identity, bridgeArgs } = options;
    const out = bridgeArgs[bridgeArgs.indexOf('--report-dir') + 1];
    const pass = bridgeArgs.includes('--pass') ? Number(bridgeArgs[bridgeArgs.indexOf('--pass') + 1]) : null;
    calls.push({ name: identity.name, role: identity.role, pass, budgets: options.budgets, prices: options.prices, prompt: options.prompt, resume: options.resume });
    fs.mkdirSync(options.directory, { recursive: true });
    fs.writeFileSync(path.join(options.directory, 'state.json'), JSON.stringify({ identity, sessionId: identity.name }));
    // What the API shim records per turn: served model and usage rows.
    fs.mkdirSync(path.join(options.directory, 'workspace'), { recursive: true });
    fs.writeFileSync(path.join(options.directory, 'workspace', 'api-session.json'), JSON.stringify({ servedModel: 'served-baseline-0901', usage: [{ prompt_tokens: 7, completion_tokens: 3, cost: 0.01, costSource: 'estimated' }] }));
    if (pass && pass === failPass) return { code: 1, failureReason: 'turn_incomplete', sessionId: identity.name, directory: options.directory, elapsedMs: 1, observedExitCode: 0 };
    const payload = identity.role === 'auditor' ? finding(identity, pass) : readReportJson(out, `crosscheck/${identity.agent}.json`).map((row) => ({ id: row.id, verdict: 'upheld', reason: 'Inert source', evidence: ['source.js:1'] }));
    commitSubmission(out, identity.name, identity, payload);
    return { code: 0, stop: 'submitted', sessionId: identity.name, directory: options.directory, elapsedMs: 1, observedExitCode: 0 };
  };
  const startSandbox = async ({ out }) => ({ container: 'inert', hostRunDir: out, stop: async () => {} });
  const request = (extra = {}) => ({ target: source, out: path.join(root, extra.dir || 'report'), surface: 's1', reviewers: parseReviewerList(reviewers), budgets: BUDGETS, prices: PRICES, ...extra });
  return { root, calls, review, startSandbox, request };
}

test('the Docker path hands every session its budgets and prices and runs exactly P passes', async (t) => {
  const f = setup(t);
  const req = f.request();
  await runOrchestratedAudit(req, { review: f.review, startSandbox: f.startSandbox });
  const auditor = f.calls.filter((c) => c.role === 'auditor');
  assert.deepEqual(auditor.map((c) => c.pass), [1, 2]);
  for (const call of f.calls) {
    assert.equal(call.budgets.toolBudget, 5, 'toolBudget reaches the session (ACP submit-now/cancel, --max-turns, API N+3)');
    assert.equal(call.budgets.maxCostUsd, 2);
    assert.deepEqual(call.prices, PRICES);
  }
  assert.match(auditor[0].prompt, /Pass 1 of 2: discover/);
  assert.match(auditor[1].prompt, /Pass 2 of 2: self-verify[\s\S]*Unread files: source\.js/);
  assert.equal(auditor[1].resume, true);
  const out = req.out;
  for (const pass of [1, 2]) assert.equal(readReportJson(out, `harness/usage/scripted-baseline/s1-pass-${pass}.json`).stop, 'submitted');
  assert.ok(fs.existsSync(path.join(out, 'submissions', 'scripted-baseline-s1-auth-pass-1.json')));
  assert.equal(readReportJson(out, 'harness/budget-health.json').state, 'COMPLETE');
  const job = readReportJson(out, 'workers.json').jobs[0];
  assert.equal(job.passesCompleted, 2);
  assert.match(readReportJson(out, 'auditors/scripted-baseline-s1-auth.json')[0].title, /^Pass 2 finding/);
  const usage = readReportJson(out, 'harness/usage/scripted-baseline/s1-pass-1.json');
  assert.deepEqual([usage.tokensIn, usage.tokensOut, usage.costSource], [7, 3, 'estimated']);
  assert.equal(job.servedModel, 'served-baseline-0901', 'W03-10: the served model reaches workers.json');
  assert.equal(readReportJson(out, 'meta.json').reviewers[0].servedModel, 'served-baseline-0901', 'and meta.reviewers');
  assert.ok(!loadAuditors(out).health.errors.some((e) => /Invalid reviewer inventory/.test(e)));
});

test('a failed later pass keeps the earlier pass, counts only completed passes and resumes at the failed pass', async (t) => {
  const f = setup(t, { failPass: 2 });
  const budgets = { ...BUDGETS, passes: 3 };
  const first = f.request({ budgets });
  const result = await runOrchestratedAudit(first, { review: f.review, startSandbox: f.startSandbox });
  assert.ok(result.stageFailures.includes('auditor_error:scripted-baseline-s1-auth'));
  const job = readReportJson(first.out, 'workers.json').jobs[0];
  assert.equal(job.passesCompleted, 1, 'passesCompleted reflects reality');
  assert.equal(job.state, 'failed');
  const kept = readReportJson(first.out, 'auditors/scripted-baseline-s1-auth.json');
  assert.match(kept[0].title, /^Pass 1 finding/, 'pass-1 work is restored and derived, not thrown away');
  assert.equal(readReportJson(first.out, 'harness/usage/scripted-baseline/s1-pass-2.json').stop, 'error');
  const errors = loadAuditors(first.out).health.errors;
  assert.ok(errors.some((e) => /worker exit is missing or nonzero/.test(e)), errors.join('\n'));
  assert.ok(!errors.some((e) => /missing or invalid outputs/.test(e)), 'the kept pass-1 report still validates');

  f.calls.length = 0;
  const resumed = f.request({ dir: 'resumed', resumeFrom: first.out, budgets });
  const second = setup(t);
  const again = await runOrchestratedAudit(resumed, { review: second.review, startSandbox: f.startSandbox });
  assert.deepEqual(second.calls.filter((c) => c.role === 'auditor').map((c) => c.pass), [2, 3], 'resume starts at the first unfinished pass and runs the rest');
  assert.deepEqual(again.stageFailures, [], 'no later pass collides with a recommitted old report');
  const after = readReportJson(resumed.out, 'workers.json').jobs[0];
  assert.equal(after.passesCompleted, 3);
  assert.equal(after.state, 'collected');
  assert.match(readReportJson(resumed.out, 'auditors/scripted-baseline-s1-auth.json')[0].title, /^Pass 3 finding/);
  for (const k of [1, 2]) assert.ok(fs.existsSync(path.join(resumed.out, 'submissions', `scripted-baseline-s1-auth-pass-${k}.json`)));
});

test('a review of the bundled fixture on the Docker path is stamped as the demo', async (t) => {
  const f = setup(t, { target: DEMO_FIXTURE });
  const req = f.request({ budgets: null });
  await runOrchestratedAudit(req, { review: f.review, startSandbox: f.startSandbox });
  assert.equal(readReportJson(req.out, 'meta.json').demo, true);
  const other = setup(t);
  const plain = other.request({ budgets: null });
  await runOrchestratedAudit(plain, { review: other.review, startSandbox: other.startSandbox });
  assert.equal(readReportJson(plain.out, 'meta.json').demo, undefined);
});
