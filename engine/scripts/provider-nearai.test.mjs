import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { families } from './reviewer-families.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';
import { dockerClientEnv } from './bridge-tools-common.mjs';
import { runToolLoop } from './provider-openai-compat.mjs';

test('a nearai reviewer receives only NEARAI_API_KEY; the bridge and sandbox receive no key', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nearai-launch-'));
  // Stale keys of removed providers in the operator's shell reach nobody: not the reviewer, the bridge or the sandbox.
  const env = { HOME: '/home/inert', PATH: '/bin', USER: 'inert', NEARAI_API_KEY: 'nk-test', ZAI_API_KEY: 'zk-stale', OPENROUTER_API_KEY: 'or-stale' };
  const launched = families.launch(parseReviewerSpec('nearai:deepseek-ai/DeepSeek-V4'), { workDir: work, bridgeArgs: ['--report-dir', work], env });
  assert.equal(launched.transport, 'api-acp');
  assert.equal(launched.invocation.env.NEARAI_API_KEY, 'nk-test');
  assert.equal(launched.invocation.env.ZAI_API_KEY, undefined);
  assert.equal(launched.invocation.env.OPENROUTER_API_KEY, undefined);
  for (const name of ['NEARAI_API_KEY', 'ZAI_API_KEY', 'OPENROUTER_API_KEY']) {
    assert.equal(launched.bridgeEnv[name], undefined);
    assert.equal(dockerClientEnv(env)[name], undefined);
  }
  const text = fs.readFileSync(path.join(work, 'api-launch.json'), 'utf8');
  assert.equal(text.includes('nk-test'), false);
  const config = JSON.parse(text);
  assert.equal(config.baseUrl, 'https://cloud-api.near.ai/v1');
  assert.equal(config.model, 'deepseek-ai/DeepSeek-V4');
  assert.equal(config.keyEnv, 'NEARAI_API_KEY');
  assert.deepEqual(config.extraBody, {});
});

test('a nearai launch without its key is a setup error', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nearai-nokey-'));
  assert.throws(() => families.launch(parseReviewerSpec('nearai:m'), { workDir: work, bridgeArgs: [], env: { PATH: '/bin', OTHER_API_KEY: 'other-test' } }), /NEARAI_API_KEY missing/);
});

test('the nearai tool loop posts to cloud-api.near.ai with the bearer key and records an unpriced run', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ model: 'm', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'submit_audit_report', arguments: '{}' } }] } }] }) };
  };
  const result = await runToolLoop({ baseUrl: 'https://cloud-api.near.ai/v1', apiKey: 'nk-test', model: 'm', provider: 'nearai', callTool: async () => 'ok', brief: 'b', fetchImpl });
  assert.equal(seen[0].url, 'https://cloud-api.near.ai/v1/chat/completions');
  assert.equal(seen[0].auth, 'Bearer nk-test');
  assert.equal(seen[0].body.provider, undefined);
  assert.equal(result.stop, 'submitted');
  // NEAR AI is not priced unless omniswarm.config.json lists prices.nearai.<model>: the cost ceiling cannot bound it.
  assert.equal(result.usage[0].costSource, 'none');
});

test('check-agents reports a NEAR AI key by name only, and the debate scrub hides provider names', async () => {
  const { checkReviewerRow } = await import('./check-agents.mjs');
  const { stripIdentity } = await import('./debate-anonymize.mjs');
  assert.deepEqual(checkReviewerRow('nearai:m', { PATH: '/bin' }), { ok: false, line: 'nearai: NEARAI_API_KEY missing' });
  const present = checkReviewerRow('nearai:m', { PATH: '/bin', NEARAI_API_KEY: 'nk-secret' });
  assert.deepEqual(present, { ok: true, line: 'nearai: key present' });
  assert.equal(JSON.stringify(present).includes('nk-secret'), false);
  assert.equal(stripIdentity('As the NearAI reviewer I agree'), 'As the a reviewer reviewer I agree');
});

// The exact document apps/api/src/worker/panel.ts accountConfigDocument('account-nearai', ['a/one', 'b/two'],
// { pipelineMode: 'step-by-step' }) writes; apps/api/test/unit/panel.test.ts pins the same object on that side.
const ACCOUNT_NEARAI_STEP_DOC = Object.freeze({
  reviewers: ['nearai:a/one', 'nearai:b/two'],
  orchestrator: 'nearai:a/one',
  pipelineMode: 'step-by-step',
  concurrency: 3,
  presets: {
    'account-nearai': {
      reviewers: ['nearai:a/one', 'nearai:b/two'], orchestrator: 'nearai:a/one', alternateJudge: 'nearai:b/two',
      assign: 'matrix', passes: 2, toolBudget: 30, maxCostUsd: 25, pipelineMode: 'step-by-step', concurrency: 3,
    },
  },
});

test('the worker\'s account-nearai config document resolves in the engine: first model orchestrates, second judges, pipeline mode kept', async () => {
  const { resolveRunConfig } = await import('./run-config.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nearai-preset-'));
  const file = path.join(dir, 'panel.config.json');
  fs.writeFileSync(file, JSON.stringify(ACCOUNT_NEARAI_STEP_DOC));
  const run = resolveRunConfig({ flags: { config: file, preset: 'account-nearai' }, root: '/nonexistent' });
  assert.deepEqual(run.reviewers.map((r) => r.family), ['nearai', 'nearai']);
  assert.equal(run.orchestrator.model, 'a/one');
  assert.equal(run.alternateJudge.model, 'b/two');
  assert.equal(run.pipelineMode, 'step-by-step');
  assert.equal(run.concurrency, 3);
});

test('a nearai orchestrator gets the submit tool of each pipeline step (stage advice, judging, general review, debate)', async () => {
  const { buildApiLaunch } = await import('./provider-api-launch.mjs');
  const { presetFor } = await import('./provider-openai-compat.mjs');
  const reviewer = parseReviewerSpec('nearai:a/one');
  const submitOf = (role, auditor) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nearai-role-'));
    buildApiLaunch(reviewer, { workDir: work, role, bridgeArgs: auditor ? ['--auditor', auditor] : [], env: { NEARAI_API_KEY: 'nk-test' } }, presetFor('nearai'));
    return JSON.parse(fs.readFileSync(path.join(work, 'api-launch.json'), 'utf8')).submitTool;
  };
  assert.equal(submitOf('orchestrator', `${reviewer.id}-stage-advice`), 'submit_stage_advice');
  assert.equal(submitOf('orchestrator', `${reviewer.id}-judge-cluster-1`), 'submit_adjudication');
  assert.equal(submitOf('orchestrator', `${reviewer.id}-general-review`), 'submit_general_review');
  assert.equal(submitOf('debater'), 'submit_debate_turn');
});

test('advice that fell back to rules because the provider refused says what to set; planned fallbacks stay quiet', async () => {
  const { adviceFallbackNote } = await import('./orchestrator-advice.mjs');
  const by = (fallbackReason, mode = 'rules_fallback') => ({ generatedBy: { mode, orchestrator: 'nearai:a/one', fallbackReason } });
  assert.match(adviceFallbackNote(by('live_required')), /nearai:a\/one did not answer \(live_required\).*OMNI_LIVE=1/);
  assert.match(adviceFallbackNote(by('setup_error')), /key variable/);
  assert.match(adviceFallbackNote(by('nothing_committed')), /rules advisor\.$/);
  for (const planned of ['scripted_orchestrator', 'offline_rules_advisor', 'no_orchestrator_configured']) assert.equal(adviceFallbackNote(by(planned)), null);
  assert.equal(adviceFallbackNote({ generatedBy: { mode: 'model', orchestrator: 'nearai:a/one' } }), null);
});

test('a reviewer stopped by live_required or a missing key gets an operator next step, not only a re-run', async () => {
  const { buildIncompletionNotes } = await import('./report-incompletion.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nearai-notes-'));
  fs.writeFileSync(path.join(dir, 'workers.json'), JSON.stringify({ jobs: [
    { name: 'nearai-a-one-s1', failure: { reason: 'live_required' } },
    { name: 'nearai-b-two-s2', failure: { reason: 'setup_error' } },
  ] }));
  const meta = { reviewers: [parseReviewerSpec('nearai:a/one'), parseReviewerSpec('nearai:b/two')], workerExits: { 'nearai-a-one-s1': 1, 'nearai-b-two-s2': 1 } };
  const notes = buildIncompletionNotes(dir, { meta, health: {} });
  const live = notes.find((n) => n.code === 'worker_live_required');
  const setup = notes.find((n) => n.code === 'worker_setup_error');
  assert.match(live.nextStep, /OMNI_LIVE=1.*--restart-failed/);
  assert.match(setup.nextStep, /key variable.*--restart-failed/);
});
