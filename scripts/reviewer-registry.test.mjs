import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewerSpec, formatReviewerSpec, reviewerId, vendorOf, parseReviewerList, reviewersOfMeta, reviewerOfJob, vendorOfJob, cliSpecsFromAgents, isReviewerId } from './reviewer-registry.mjs';

test('parses cli, key, openrouter, nearai and scripted specs', () => {
  assert.deepEqual(parseReviewerSpec('cli:claude:opus'), { id: 'cli-claude-opus', family: 'cli', provider: 'claude', vendor: 'anthropic', model: 'opus' });
  assert.equal(parseReviewerSpec('cli:codex:gpt-6.1-sol').id, 'cli-codex-gpt-6-1-sol');
  assert.equal(parseReviewerSpec('key:zai:glm-5.3').id, 'key-zai-glm-5-3');
  assert.equal(parseReviewerSpec('scripted:baseline').id, 'scripted-baseline');
  assert.equal(parseReviewerSpec('scripted:baseline:x1').model, 'x1');
  assert.equal(parseReviewerSpec('nearai:tee-model').vendor, 'nearai');
  const or = parseReviewerSpec('openrouter:qwen/qwen3.8-max-0902');
  assert.equal(or.id, 'openrouter-qwen-qwen3-8-max-0902');
  assert.equal(or.model, 'qwen/qwen3.8-max-0902');
  assert.equal(or.vendor, 'alibaba');
  assert.ok(!or.id.includes('/'));
});

test('a label overrides the id and round-trips', () => {
  const r = parseReviewerSpec('key:zai:glm-5.3#glm-a');
  assert.equal(r.id, 'glm-a');
  assert.equal(r.label, 'glm-a');
  assert.equal(formatReviewerSpec(r), 'key:zai:glm-5.3#glm-a');
  for (const spec of ['cli:claude:opus', 'openrouter:x-ai/grok-4.7', 'scripted:lazy', 'scripted:lazy:two', 'nearai:m']) assert.equal(formatReviewerSpec(parseReviewerSpec(spec)), spec);
});

test('ids are slugs of at most 64 characters and stay unique when truncated', () => {
  assert.equal(reviewerId('A/b.c:d'), 'a-b-c-d');
  const long = `openrouter:org/${'x'.repeat(100)}`;
  const a = reviewerId(long);
  assert.ok(a.length <= 64);
  assert.notEqual(a, reviewerId(`${long}y`));
  assert.ok(isReviewerId(a));
});

test('vendors are derived for every family', () => {
  assert.equal(vendorOf('openrouter:anthropic/claude-opus-5.5'), vendorOf('cli:claude:opus'));
  assert.equal(vendorOf('cli:claude-zai:glm-5.3'), 'zai');
  assert.equal(vendorOf('cli:grok:grok-4.7'), 'xai');
  assert.equal(vendorOf('cli:agy:gemini-4-argon-high'), 'google');
  assert.equal(vendorOf('cli:codex:gpt-6.1-sol'), 'openai');
  assert.equal(vendorOf('key:zai:glm-5.3'), 'zai');
  assert.equal(vendorOf('openrouter:x-ai/grok-4.7'), 'xai');
  assert.equal(vendorOf('openrouter:z-ai/glm-5.3'), 'zai');
  assert.equal(vendorOf('openrouter:somelab/model'), 'somelab');
  assert.equal(vendorOf('scripted:baseline'), 'scripted');
});

test('duplicates, injection and malformed specs are rejected', () => {
  assert.throws(() => parseReviewerList(['cli:claude:opus', 'cli:claude:opus']), { code: 'REVIEWER_DUPLICATE' });
  assert.equal(parseReviewerList(['cli:claude:opus', 'cli:claude:opus#second']).length, 2);
  for (const bad of ['cli:claude:op;rm', 'cli:claude', 'bogus:x:y', 'cli:Claude:opus', 'cli:claude:', '', 'openrouter:a b', 'cli:claude:opus#BAD']) {
    assert.throws(() => parseReviewerSpec(bad), { code: 'REVIEWER_SPEC_INVALID' }, bad);
  }
  assert.throws(() => parseReviewerSpec(7), { code: 'REVIEWER_SPEC_INVALID' });
});

test('legacy meta (agents + models) maps to adapter-named reviewers; new meta is used as written', () => {
  const old = reviewersOfMeta({ agents: ['claude', 'codex'], models: { claude: 'opus' } });
  assert.deepEqual(old.map((r) => [r.id, r.vendor, r.model]), [['claude', 'anthropic', 'opus'], ['codex', 'openai', 'gpt-6.1-sol']]);
  const fresh = [{ id: 'cli-claude-sonnet', family: 'cli', provider: 'claude', vendor: 'anthropic', model: 'sonnet' }];
  assert.equal(reviewersOfMeta({ agents: ['cli-claude-sonnet'], reviewers: fresh }), fresh);
  assert.deepEqual(reviewersOfMeta({}), []);
});

test('job names resolve to reviewers even when ids contain hyphens', () => {
  const reviewers = [{ id: 'cli-claude-opus', vendor: 'anthropic' }, { id: 'openrouter-anthropic-x', vendor: 'anthropic' }, { id: 'cli-claude', vendor: 'other' }];
  assert.equal(reviewerOfJob('cli-claude-opus-s2-input', reviewers).id, 'cli-claude-opus');
  assert.equal(vendorOfJob('openrouter-anthropic-x-s1-auth', reviewers), 'anthropic');
  assert.equal(vendorOfJob('openrouter-anthropic-x', reviewers), 'anthropic');
  assert.equal(vendorOfJob('nobody-s1-auth', reviewers), null);
  assert.equal(reviewerOfJob('junk', reviewers), null);
});

test('--agents style input maps to cli specs with defaults and overrides', () => {
  assert.deepEqual(cliSpecsFromAgents(['claude', 'codex'], { claude: 'sonnet' }), ['cli:claude:sonnet', 'cli:codex:gpt-6.1-sol']);
  assert.throws(() => cliSpecsFromAgents(['nope']), { code: 'REVIEWER_SPEC_INVALID' });
});
