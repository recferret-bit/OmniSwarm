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

test('an uninstalled family is a plan problem that names the wave', () => {
  const r = resolveRunConfig({ flags: { reviewers: 'nearai:tee-model' }, root: '/nonexistent' });
  const { text, problems } = renderPlan({ ...r });
  assert.match(problems[0], /family `nearai` not installed yet \(W03 \(H\+\)\)/);
  assert.match(text, /nearai-tee-model/);
  const openrouter = renderPlan({ ...resolveRunConfig({ flags: { reviewers: 'openrouter:qwen/qwen3.8-max-0902,key:zai:glm-5.3' }, root: '/nonexistent' }) });
  assert.deepEqual(openrouter.problems, []);
  assert.match(openrouter.text, /openrouter-qwen-qwen3-8-max-0902\s+openrouter\s+alibaba/);
  assert.match(openrouter.text, /env OPENROUTER_API_KEY\s+transport api-acp/);
  assert.match(openrouter.text, /key-zai-glm-5-3\s+key\s+zai/);
});

test('recommended orchestrator follows the OD-05 order and says why', () => {
  const none = recommendedOrchestrator({ env: { PATH: '/nonexistent' } });
  assert.equal(none.spec, null);
  assert.match(none.reason, /none available/);
  const { text } = renderPlan({ reviewers: two, assign: 'matrix', budgets: { passes: 2, toolBudget: 40, debate: { rounds: 2 }, maxCostUsd: null }, orchestrator: 'recommended', env: { PATH: '/nonexistent' } });
  assert.match(text, /Orchestrator: recommended -> none/);
  assert.equal(parseReviewerSpec('cli:claude:opus').family, 'cli');
});

test('the plan prints the alternate judge pickJudge would use: explicit, default, none, or not used', () => {
  const budgets = { passes: 1, toolBudget: 40, debate: { rounds: 2, maxClusters: 25, toolBudget: 12 }, maxCostUsd: null };
  const plan = (extra) => renderPlan({ reviewers: two, assign: 'matrix', budgets, ...extra }).text;
  assert.match(plan({ orchestrator: parseReviewerSpec('cli:claude:opus') }), /^Alternate judge: cli:codex:gpt-6\.1-sol \(default: first run reviewer of another vendor than anthropic\)$/m);
  assert.match(plan({ orchestrator: parseReviewerSpec('cli:claude:opus'), alternateJudge: parseReviewerSpec('key:zai:glm-5.3') }), /^Alternate judge: key:zai:glm-5\.3$/m);
  assert.match(renderPlan({ reviewers: [two[0]], assign: 'matrix', budgets, orchestrator: parseReviewerSpec('cli:claude:sonnet') }).text, /^Alternate judge: none \(no run reviewer of another vendor than anthropic; its clusters stay DISPUTED, no_independent_judge\)$/m);
  assert.match(plan({ orchestrator: parseReviewerSpec('scripted:judge') }), /^Alternate judge: not used/m);
  assert.match(plan({}), /^Orchestrator: none \(no debate or general review\)$/m);
  assert.doesNotMatch(plan({}), /Alternate judge/);
  assert.doesNotMatch(plan({ orchestrator: parseReviewerSpec('cli:claude:opus') }), /No phase uses it yet/);
});

test('legacy header labels stay adapter names for cli-only unique providers', () => {
  assert.deepEqual(headerLabels(two), { agents: 'claude codex', models: 'claude=opus codex=gpt-6.1-sol' });
  assert.equal(headerLabels(parseReviewerList(['cli:claude:a', 'cli:claude:b'])).agents, 'cli-claude-a cli-claude-b');
});
