import test from 'node:test';
import assert from 'node:assert/strict';
import { publishReviewers } from './reviewer-publish.mjs';
import { keyFingerprint } from './reviewer-env.mjs';
import { families } from './reviewer-families.mjs';
import { parseReviewerList } from './reviewer-registry.mjs';

const ENV = { NEARAI_API_KEY: 'nk-test-value', ANTHROPIC_AUTH_TOKEN: 'unrelated-token' };

test('each reviewer is fingerprinted from its own key variable', () => {
  const reviewers = parseReviewerList(['nearai:deepseek-ai/DeepSeek-V4', 'nearai:Qwen/Qwen3.8-Max', 'cli:claude:opus', 'scripted:baseline']);
  const [deepseek, qwen, claude, scripted] = publishReviewers(reviewers, ENV);
  assert.equal(deepseek.keyFingerprint, keyFingerprint('nk-test-value'));
  assert.notEqual(deepseek.keyFingerprint, keyFingerprint('unrelated-token'));
  assert.equal(qwen.keyFingerprint, keyFingerprint('nk-test-value'));
  assert.equal(claude.keyFingerprint, undefined);
  assert.equal(scripted.keyFingerprint, undefined);
  const json = JSON.stringify([deepseek, qwen, claude, scripted]);
  for (const secret of Object.values(ENV)) assert.equal(json.includes(secret), false);
});

test('a reviewer whose key is unset gets no fingerprint', () => {
  const [row] = publishReviewers(parseReviewerList(['nearai:deepseek-ai/DeepSeek-V4']), { ANTHROPIC_AUTH_TOKEN: 'unrelated-token' });
  assert.equal(row.keyFingerprint, undefined);
  assert.equal(families.fingerprintEnv(row), 'NEARAI_API_KEY');
});
