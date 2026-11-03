import test from 'node:test';
import assert from 'node:assert/strict';
import { publishReviewers } from './reviewer-publish.mjs';
import { keyFingerprint } from './reviewer-env.mjs';
import { families } from './reviewer-families.mjs';
import { parseReviewerList } from './reviewer-registry.mjs';

const ENV = { ZAI_API_KEY: 'zk-test-value', OPENROUTER_API_KEY: 'or-test-value', ANTHROPIC_AUTH_TOKEN: 'unrelated-token' };

test('each reviewer is fingerprinted from its own key variable', () => {
  const reviewers = parseReviewerList(['cli:claude-zai:glm-5.3', 'key:zai:glm-5.3', 'openrouter:qwen/qwen3.8-max-0902', 'cli:claude:opus', 'scripted:baseline']);
  const [zaiCli, zaiKey, openrouter, claude, scripted] = publishReviewers(reviewers, ENV);
  assert.equal(zaiCli.keyFingerprint, keyFingerprint('zk-test-value'));
  assert.notEqual(zaiCli.keyFingerprint, keyFingerprint('unrelated-token'));
  assert.equal(zaiKey.keyFingerprint, keyFingerprint('zk-test-value'));
  assert.equal(openrouter.keyFingerprint, keyFingerprint('or-test-value'));
  assert.equal(claude.keyFingerprint, undefined);
  assert.equal(scripted.keyFingerprint, undefined);
  const json = JSON.stringify([zaiCli, zaiKey, openrouter, claude, scripted]);
  for (const secret of Object.values(ENV)) assert.equal(json.includes(secret), false);
});

test('a reviewer whose key is unset gets no fingerprint', () => {
  const [row] = publishReviewers(parseReviewerList(['cli:claude-zai:glm-5.3']), { ANTHROPIC_AUTH_TOKEN: 'unrelated-token' });
  assert.equal(row.keyFingerprint, undefined);
  assert.equal(families.fingerprintEnv(row), 'ZAI_API_KEY');
});
