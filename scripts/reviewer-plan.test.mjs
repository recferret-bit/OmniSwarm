import test from 'node:test';
import assert from 'node:assert/strict';
import { assignJobs, recommendedOrchestrator, renderPlan, headerLabels } from './reviewer-plan.mjs';
import { parseReviewerList, parseReviewerSpec } from './reviewer-registry.mjs';
import { resolveRunConfig } from './run-config.mjs';

const two = parseReviewerList(['cli:claude:opus', 'cli:codex:gpt-6.1-sol']);
const four = parseReviewerList(['cli:claude:opus', 'cli:codex:gpt-6.1-sol', 'cli:grok:grok-4.7', 'cli:agy:gemini-4-argon-high']);

test('matrix makes reviewers x surfaces jobs, round-robin keeps today\'s six', () => {
  assert.equal(assignJobs({ reviewers: two, assign: 'matrix' }).length, 12);
  assert.equal(assignJobs({ reviewers: four, assign: 'matrix' }).length, 24);
  const rr = assignJobs({ reviewers: two, assign: 'round-robin' });
  assert.deepEqual(rr.map((j) => j.name), ['cli-claude-opus-s1-auth', 'cli-codex-gpt-6-1-sol-s2-input', 'cli-claude-opus-s3-logic', 'cli-codex-gpt-6-1-sol-s4-config', 'cli-claude-opus-s5-deps', 'cli-codex-gpt-6-1-sol-s6-client']);
  assert.equal(assignJobs({ reviewers: two, surfaceArg: 's2', assign: 'round-robin' }).length, 2);
  assert.throws(() => assignJobs({ reviewers: two, surfaceArg: 'zz' }), /Unknown surface/);
});

test('plan prints the reviewer table, a 4 x 6 matrix and budgets', () => {
  const { text, problems } = renderPlan({ reviewers: four, assign: 'matrix', budgets: { passes: 2, toolBudget: 40, debate: { rounds: 2 }, maxCostUsd: null }, orchestrator: null });
  assert.deepEqual(problems, []);
  assert.match(text, /cli-claude-opus\s+cli\s+anthropic\s+opus\s+yes/);
  assert.match(text, /Assignment: matrix \(24 jobs\)/);
  assert.equal(text.split('\n').filter((l) => /^  cli-.*x\s+x\s+x\s+x\s+x\s+x/.test(l)).length, 4);
});

test('an uninstalled family is a plan problem that names the wave', (t) => {
  const r = resolveRunConfig({ flags: { reviewers: 'openrouter:qwen/qwen3.8-max-0902' }, root: '/nonexistent' });
  const { text, problems } = renderPlan({ ...r });
  assert.match(problems[0], /family `openrouter` not installed yet \(W03\)/);
  assert.match(text, /openrouter-qwen-qwen3-8-max-0902/);
});

test('recommended orchestrator follows the OD-05 order and says why', () => {
  const none = recommendedOrchestrator({ env: { PATH: '/nonexistent' } });
  assert.equal(none.spec, null);
  assert.match(none.reason, /none available/);
  const { text } = renderPlan({ reviewers: two, assign: 'matrix', budgets: { passes: 2, toolBudget: 40, debate: { rounds: 2 }, maxCostUsd: null }, orchestrator: 'recommended', env: { PATH: '/nonexistent' } });
  assert.match(text, /Orchestrator: recommended -> none/);
  assert.equal(parseReviewerSpec('cli:claude:opus').family, 'cli');
});

test('legacy header labels stay adapter names for cli-only unique providers', () => {
  assert.deepEqual(headerLabels(two), { agents: 'claude codex', models: 'claude=opus codex=gpt-6.1-sol' });
  assert.equal(headerLabels(parseReviewerList(['cli:claude:a', 'cli:claude:b'])).agents, 'cli-claude-a cli-claude-b');
});
