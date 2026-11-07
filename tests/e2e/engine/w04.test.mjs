import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetHealth } from '../../../engine/scripts/verification-health.mjs';
import { runOrchestratedAudit } from '../../../engine/scripts/docker-agent-orchestrator.mjs';
import { commitSubmission } from '../../../engine/scripts/audit-submission.mjs';
import { keyFingerprint } from '../../../engine/scripts/reviewer-env.mjs';
import { parseReviewerList } from '../../../engine/scripts/reviewer-registry.mjs';
import { grokMaxTurnsSupport } from '../../../engine/scripts/provider-cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const run = (args, env = {}) => spawnSync(path.join(ROOT, 'bin', 'audit'), args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 180_000 });

test('plan prints passes, grace and the worst-case call count', () => {
  const result = run(['run', '--repo', 'engine/scripts/demo-fixture', '--reviewers', 'scripted:baseline,scripted:lazy,key:zai:glm-5.3', '--passes', '2', '--tool-budget', '5', '--surface', 's1', '--plan']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scripted-lazy\s+2 × 5 \(\+3\)\s+discover, self-verify\s+max 16 calls\s+gate: bridge\+loop/);
  assert.match(result.stdout, /Pass roles: discover, self-verify/);
  const zero = run(['run', '--repo', 'engine/scripts/demo-fixture', '--reviewers', 'scripted:baseline', '--passes', '0', '--plan']);
  assert.equal(zero.status, 2);
  assert.match(zero.stderr, /passes must be 1–5/);
});

test('scripted and replayed reviewers record two passes, a budget stop and a cost stop', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'w04-'));
  fs.rmSync(out, { recursive: true });
  const result = run(['run', '--repo', 'engine/scripts/demo-fixture', '--reviewers', 'scripted:baseline,scripted:lazy', '--surface', 's1', '--passes', '2', '--tool-budget', '5', '--out', out], { OMNI_DEMO_HOST: '1' });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const lazy = JSON.parse(fs.readFileSync(path.join(out, 'harness', 'usage', 'scripted-lazy', 's1-pass-1.json'), 'utf8'));
  assert.equal(lazy.calls, 5);
  assert.equal(lazy.stop, 'budget');
  assert.ok(fs.existsSync(path.join(out, 'harness', 'usage', 'scripted-lazy', 's1-pass-2.json')));
  assert.ok(fs.existsSync(path.join(out, 'harness', 'usage', 'scripted-baseline', 's1-pass-2.json')));
  const budget = JSON.parse(fs.readFileSync(path.join(out, 'harness', 'budget-scripted-lazy.json'), 'utf8'));
  assert.equal(budget.passes['s1:1'].calls, 5);
  assert.ok(budget.passes['s1:1'].finalizeOnlyAt);
  assert.ok(budget.passes['s1:1'].filesRead.includes('src/lib.rs'));
  const jobs = JSON.parse(fs.readFileSync(path.join(out, 'workers.json'), 'utf8')).jobs;
  assert.ok(jobs.every((job) => job.passesCompleted === 2));
  assert.ok(fs.readdirSync(path.join(out, 'submissions')).some((name) => name.includes('scripted-baseline') && name.includes('pass-1')));
  const health = JSON.parse(fs.readFileSync(path.join(out, 'harness', 'budget-health.json'), 'utf8'));
  assert.equal(health.state, 'COMPLETE');
  assert.ok(health.budgetStops.some((row) => row.reviewer === 'scripted-lazy'));
  assert.equal(budgetHealth([{ reviewer: 'scripted-lazy', stop: 'budget', submitted: false }]).state, 'INCOMPLETE');
});

test('a priced replay under the cost ceiling records stop cost and skips pass 2', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'w04-cost-'));
  fs.rmSync(out, { recursive: true });
  const result = run(['run', '--repo', 'engine/scripts/demo-fixture', '--reviewers', 'key:zai:glm-5.3', '--surface', 's1', '--passes', '2', '--tool-budget', '5', '--max-cost-usd', '0.0001', '--out', out], {
    OMNI_DEMO_HOST: '1', OMNI_HTTP_REPLAY: path.join(ROOT, 'engine', 'scripts', 'provider-fixtures', 'w04'), ZAI_API_KEY: 'zk-test',
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const first = JSON.parse(fs.readFileSync(path.join(out, 'harness', 'usage', 'key-zai-glm-5-3', 's1-pass-1.json'), 'utf8'));
  const second = JSON.parse(fs.readFileSync(path.join(out, 'harness', 'usage', 'key-zai-glm-5-3', 's1-pass-2.json'), 'utf8'));
  assert.equal(first.stop, 'cost');
  assert.equal(second.skipped, 'cost_ceiling');
  const metaText = fs.readFileSync(path.join(out, 'meta.json'), 'utf8');
  assert.equal(JSON.parse(metaText).reviewers[0].keyFingerprint, keyFingerprint('zk-test'), 'host runs record the key fingerprint');
  assert.equal(metaText.includes('zk-test'), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'harness', 'budget-health.json'), 'utf8')).state, 'INCOMPLETE', 'a cost stop without a report is recorded, not hidden');
});

test('Docker path: budgets and prices reach every session, each pass is recorded, a failed pass keeps the last one', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'w04-docker-'));
  const target = path.join(root, 'source');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'source.js'), 'export const inert = true;\n');
  const seen = [];
  const review = async (options) => {
    const { identity, bridgeArgs, directory } = options;
    const out = bridgeArgs[bridgeArgs.indexOf('--report-dir') + 1];
    const pass = bridgeArgs.includes('--pass') ? Number(bridgeArgs[bridgeArgs.indexOf('--pass') + 1]) : null;
    seen.push({ name: identity.name, pass, toolBudget: options.budgets?.toolBudget, maxCostUsd: options.budgets?.maxCostUsd, prices: options.prices });
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ identity, sessionId: identity.name }));
    if (identity.name === 'scripted-lazy-s1-auth' && pass === 2) return { code: 1, failureReason: 'turn_incomplete', sessionId: identity.name, directory, elapsedMs: 1, observedExitCode: 0 };
    const payload = identity.role === 'auditor'
      ? [{ title: `Pass ${pass} ${identity.name}`, surface: 'S1', severity: 'low', confidence: 'probable', location: ['source.js:1'], impact: 'Fixture', preconditions: 'Fixture', analysis: 'Read source.js:1', validation: 'Fixture only', attack: [], poc: '', fix: 'Fixture' }, { verified_safe: [] }]
      : JSON.parse(fs.readFileSync(path.join(out, 'crosscheck', `${identity.agent}.json`), 'utf8')).map((row) => ({ id: row.id, verdict: 'upheld', reason: 'Fixture', evidence: ['source.js:1'] }));
    commitSubmission(out, identity.name, identity, payload);
    return { code: 0, stop: 'submitted', sessionId: identity.name, directory, elapsedMs: 1, observedExitCode: 0 };
  };
  const out = path.join(root, 'report');
  const prices = { zai: { 'glm-5.3': { inPerMTok: 1, outPerMTok: 2 } } };
  await runOrchestratedAudit({ target, out, surface: 's1', reviewers: parseReviewerList(['scripted:baseline', 'scripted:lazy']), budgets: { passes: 2, toolBudget: 5, maxCostUsd: 1 }, prices }, { review, startSandbox: async () => ({ container: 'inert', hostRunDir: out, stop: async () => {} }) });
  assert.ok(seen.length >= 4 && seen.every((call) => call.toolBudget === 5 && call.maxCostUsd === 1 && call.prices === prices));
  const jobs = JSON.parse(fs.readFileSync(path.join(out, 'workers.json'), 'utf8')).jobs;
  assert.equal(jobs.find((job) => job.name === 'scripted-baseline-s1-auth').passesCompleted, 2);
  assert.equal(jobs.find((job) => job.name === 'scripted-lazy-s1-auth').passesCompleted, 1);
  for (const pass of [1, 2]) assert.ok(fs.existsSync(path.join(out, 'harness', 'usage', 'scripted-baseline', `s1-pass-${pass}.json`)));
  assert.match(JSON.parse(fs.readFileSync(path.join(out, 'auditors', 'scripted-lazy-s1-auth.json'), 'utf8'))[0].title, /^Pass 1 /);
  assert.ok(fs.existsSync(path.join(out, 'harness', 'budget-health.json')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('grok plan shows max-turns derived from the budget when the CLI advertises the flag', () => {
  const result = run(['run', '--repo', 'engine/scripts/demo-fixture', '--reviewers', 'cli:grok:grok-4.7', '--tool-budget', '10', '--passes', '1', '--plan']);
  assert.equal(result.status, 0, result.stderr);
  if (grokMaxTurnsSupport()) {
    assert.match(result.stdout, /gate: bridge\+acp\+--max-turns/);
    assert.match(result.stdout, /--max-turns 13/);
  } else {
    assert.doesNotMatch(result.stdout, /--max-turns/);
    assert.match(result.stdout, /cli-grok-grok-4-7\s+1 × 10 \(\+3\)\s+discover\s+max 13 calls\s+gate: bridge\+acp/);
  }
});
