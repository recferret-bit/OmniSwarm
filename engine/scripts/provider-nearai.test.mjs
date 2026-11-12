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
  const env = { HOME: '/home/inert', PATH: '/bin', USER: 'inert', NEARAI_API_KEY: 'nk-test', ZAI_API_KEY: 'zk-test', OPENROUTER_API_KEY: 'or-test' };
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
  assert.throws(() => families.launch(parseReviewerSpec('nearai:m'), { workDir: work, bridgeArgs: [], env: { PATH: '/bin', OPENROUTER_API_KEY: 'or-test' } }), /NEARAI_API_KEY missing/);
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
  assert.equal(stripIdentity('As the NearAI reviewer on OpenRouter I agree'), 'As the a reviewer reviewer on a reviewer I agree');
});

test('the worker\'s account-nearai config document resolves in the engine: first model orchestrates, second judges', async () => {
  const { resolveRunConfig } = await import('./run-config.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nearai-preset-'));
  const file = path.join(dir, 'panel.config.json');
  // Same shape as apps/api/src/worker/panel.ts accountConfigDocument('account-nearai', [...]).
  const reviewers = ['nearai:a/one', 'nearai:b/two'];
  fs.writeFileSync(file, JSON.stringify({ reviewers, orchestrator: reviewers[0], presets: { 'account-nearai': { reviewers, orchestrator: reviewers[0], alternateJudge: reviewers[1], assign: 'matrix', passes: 2, toolBudget: 30, maxCostUsd: 25 } } }));
  const run = resolveRunConfig({ flags: { config: file, preset: 'account-nearai' }, root: '/nonexistent' });
  assert.deepEqual(run.reviewers.map((r) => r.family), ['nearai', 'nearai']);
  assert.equal(run.orchestrator.model, 'a/one');
  assert.equal(run.alternateJudge.model, 'b/two');
});
