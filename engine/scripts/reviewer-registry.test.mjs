import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewerSpec, formatReviewerSpec, reviewerId, vendorOf, parseReviewerList, reviewersOfMeta, reviewerOfJob, vendorOfJob, cliSpecsFromAgents, isReviewerId } from './reviewer-registry.mjs';

test('parses cli, key, nearai and scripted specs', () => {
  assert.deepEqual(parseReviewerSpec('cli:claude:opus'), { id: 'cli-claude-opus', family: 'cli', provider: 'claude', vendor: 'anthropic', model: 'opus' });
  assert.equal(parseReviewerSpec('cli:codex:gpt-6.1-sol').id, 'cli-codex-gpt-6-1-sol');
  assert.equal(parseReviewerSpec('key:anthropic:claude-opus-5-5').id, 'key-anthropic-claude-opus-5-5');
  assert.equal(parseReviewerSpec('scripted:baseline').id, 'scripted-baseline');
  assert.equal(parseReviewerSpec('scripted:baseline:x1').model, 'x1');
  assert.equal(parseReviewerSpec('nearai:tee-model').vendor, 'nearai');
  const hosted = parseReviewerSpec('nearai:Qwen/Qwen3.8-Max');
  assert.deepEqual(hosted, { id: 'nearai-qwen-qwen3-8-max', family: 'nearai', provider: 'nearai', vendor: 'alibaba', model: 'Qwen/Qwen3.8-Max' });
  assert.ok(!hosted.id.includes('/'));
});

test('a label overrides the id and round-trips', () => {
  const r = parseReviewerSpec('nearai:deepseek-ai/DeepSeek-V4#ds-a');
  assert.equal(r.id, 'ds-a');
  assert.equal(r.label, 'ds-a');
  assert.equal(formatReviewerSpec(r), 'nearai:deepseek-ai/DeepSeek-V4#ds-a');
  for (const spec of ['cli:claude:opus', 'key:anthropic:claude-opus-5-5', 'nearai:moonshotai/Kimi-K3', 'scripted:lazy', 'scripted:lazy:two', 'nearai:m']) assert.equal(formatReviewerSpec(parseReviewerSpec(spec)), spec);
});

test('ids are slugs of at most 64 characters and stay unique when truncated', () => {
  assert.equal(reviewerId('A/b.c:d'), 'a-b-c-d');
  const long = `nearai:org/${'x'.repeat(100)}`;
  const a = reviewerId(long);
  assert.ok(a.length <= 64);
  assert.notEqual(a, reviewerId(`${long}y`));
  assert.ok(isReviewerId(a));
});

test('vendors are derived for every family', () => {
  assert.equal(vendorOf('nearai:anthropic/claude-opus-5.5'), vendorOf('cli:claude:opus'));
  assert.equal(vendorOf('cli:grok:grok-4.7'), 'xai');
  assert.equal(vendorOf('cli:agy:gemini-4-argon-high'), 'google');
  assert.equal(vendorOf('cli:codex:gpt-6.1-sol'), 'openai');
  assert.equal(vendorOf('key:anthropic:claude-opus-5-5'), 'anthropic');
  assert.equal(vendorOf('nearai:x-ai/grok-4.7'), 'xai');
  // Vendor is who trained the model: GLM on NEAR AI Cloud is Zhipu's (vendor id `zai`), whoever serves it.
  assert.equal(vendorOf('nearai:zai-org/GLM-5.3'), 'zai');
  assert.equal(vendorOf('nearai:somelab/model'), 'somelab');
  assert.equal(vendorOf('scripted:baseline'), 'scripted');
});

test('duplicates, injection and malformed specs are rejected', () => {
  assert.throws(() => parseReviewerList(['cli:claude:opus', 'cli:claude:opus']), { code: 'REVIEWER_DUPLICATE' });
  assert.equal(parseReviewerList(['cli:claude:opus', 'cli:claude:opus#second']).length, 2);
  for (const bad of ['cli:claude:op;rm', 'cli:claude', 'bogus:x:y', 'cli:Claude:opus', 'cli:claude:', '', 'nearai:a b', 'cli:claude:opus#BAD']) {
    assert.throws(() => parseReviewerSpec(bad), { code: 'REVIEWER_SPEC_INVALID' }, bad);
  }
  assert.throws(() => parseReviewerSpec(7), { code: 'REVIEWER_SPEC_INVALID' });
  // The openrouter family was removed: its specs no longer parse.
  for (const removed of ['openrouter:qwen/qwen3.8-max-0902', 'openrouter:auto']) assert.throws(() => parseReviewerSpec(removed), { code: 'REVIEWER_SPEC_INVALID' }, removed);
});

test('legacy meta (agents + models) maps to adapter-named reviewers; new meta is used as written', () => {
  const old = reviewersOfMeta({ agents: ['claude', 'codex'], models: { claude: 'opus' } });
  assert.deepEqual(old.map((r) => [r.id, r.vendor, r.model]), [['claude', 'anthropic', 'opus'], ['codex', 'openai', 'gpt-6.1-sol']]);
  const fresh = [{ id: 'cli-claude-sonnet', family: 'cli', provider: 'claude', vendor: 'anthropic', model: 'sonnet' }];
  assert.equal(reviewersOfMeta({ agents: ['cli-claude-sonnet'], reviewers: fresh }), fresh);
  assert.deepEqual(reviewersOfMeta({}), []);
});

test('job names resolve to reviewers even when ids contain hyphens', () => {
  const reviewers = [{ id: 'cli-claude-opus', vendor: 'anthropic' }, { id: 'nearai-anthropic-x', vendor: 'anthropic' }, { id: 'cli-claude', vendor: 'other' }];
  assert.equal(reviewerOfJob('cli-claude-opus-s2-input', reviewers).id, 'cli-claude-opus');
  assert.equal(vendorOfJob('nearai-anthropic-x-s1-auth', reviewers), 'anthropic');
  assert.equal(vendorOfJob('nearai-anthropic-x', reviewers), 'anthropic');
  assert.equal(vendorOfJob('nobody-s1-auth', reviewers), null);
  assert.equal(reviewerOfJob('junk', reviewers), null);
});

test('--agents style input maps to cli specs with defaults and overrides', () => {
  assert.deepEqual(cliSpecsFromAgents(['claude', 'codex'], { claude: 'sonnet' }), ['cli:claude:sonnet', 'cli:codex:gpt-6.1-sol']);
  assert.throws(() => cliSpecsFromAgents(['nope']), { code: 'REVIEWER_SPEC_INVALID' });
});

test('a hosted or resold model keeps the vendor that trained it', () => {
  // The same family through several routes is one vendor, so it cannot agree with itself or judge itself.
  for (const spec of ['cli:claude:opus', 'key:anthropic:claude-opus-5-5', 'nearai:anthropic/claude-opus-5.5', 'nearai:somehost/claude-opus-5.5', 'nearai:anthropic/claude-sonnet-5']) assert.equal(vendorOf(spec), 'anthropic', spec);
  assert.equal(vendorOf('nearai:fireworks/qwen3-coder-next'), vendorOf('nearai:Qwen/Qwen3.8-Max'));
  assert.equal(vendorOf('nearai:zai-org/GLM-5.3'), vendorOf('nearai:THUDM/glm-4-9b'));
  assert.equal(vendorOf('nearai:deepseek-ai/DeepSeek-V4'), vendorOf('nearai:deepseek/deepseek-chat'));
  assert.equal(vendorOf('nearai:meta-llama/Llama-5-70B'), 'meta');
  assert.equal(vendorOf('nearai:openai/o3-pro'), 'openai');
  assert.equal(vendorOf('nearai:openai/gpt-oss-120b'), 'openai');
  assert.equal(vendorOf('nearai:moonshotai/Kimi-K3'), 'moonshot');
});

test('different families stay different vendors and unknown models are not guessed', () => {
  const panel = ['cli:claude:opus', 'cli:codex:gpt-6.1-sol', 'cli:grok:grok-4.7', 'cli:agy:gemini-4-argon-high', 'nearai:Qwen/Qwen3.8-Max', 'nearai:deepseek-ai/DeepSeek-V4'].map((spec) => vendorOf(spec));
  assert.equal(new Set(panel).size, panel.length);
  // No family in the name: the org is the vendor; no org either: the host.
  assert.equal(vendorOf('nearai:somelab/model'), 'somelab');
  assert.equal(vendorOf('nearai:somelab/other-model'), 'somelab');
  assert.equal(vendorOf('nearai:tee-model'), 'nearai');
  assert.equal(vendorOf('nearai:auto'), 'nearai');
  // A family word inside another word is not a match ("regrok", "o3" inside a longer token).
  assert.equal(vendorOf('nearai:somelab/regrokker-1'), 'somelab');
  assert.equal(vendorOf('nearai:somelab/turbo300'), 'somelab');
  // The CLI and key families name their provider; a model name does not override it.
  assert.equal(vendorOf('key:openai:claude-compatible'), 'openai');
  // A removed CLI provider has no vendor table entry; families.check refuses it (provider-key.test.mjs).
  assert.equal(vendorOf('cli:claude-zai:glm-5.3'), 'claude-zai');
});
