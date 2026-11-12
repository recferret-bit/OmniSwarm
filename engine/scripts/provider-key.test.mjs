import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FamilyError, families } from './reviewer-families.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';
import { dockerClientEnv } from './bridge-tools-common.mjs';
import { keyFingerprint } from './reviewer-env.mjs';

// The `key` family is generic (`key:<provider>:<model>`) with no installed provider: Z.AI was removed and the
// direct vendor APIs are not built yet. NEAR AI Cloud is its own `nearai` family (provider-nearai.test.mjs).
test('the key family has no installed provider: key:zai is unknown and launches nothing', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'api-launch-'));
  const env = { HOME: '/home/inert', PATH: '/bin', USER: 'inert', ZAI_API_KEY: 'zk-stale', ZAI_BASE_URL: 'https://example.invalid/v4' };
  const zai = parseReviewerSpec('key:zai:glm-5.3');
  const verdict = families.check(zai);
  assert.equal(verdict.code, 'PROVIDER_UNKNOWN');
  assert.match(verdict.reason, /unknown provider zai/);
  assert.throws(() => families.launch(zai, { workDir: work, bridgeArgs: ['--report-dir', work], env }), (error) => error instanceof FamilyError && error.code === 'PROVIDER_UNKNOWN');
  assert.equal(fs.existsSync(path.join(work, 'api-launch.json')), false);
  assert.deepEqual(families.envAllowlist(zai), []);
  assert.equal(families.fingerprintEnv(zai), null);
  assert.equal(families.get('key').available(zai, env), false);
  const fingerprint = keyFingerprint('zk-test');
  assert.equal(fingerprint.length, 8);
  assert.equal(JSON.stringify({ keyFingerprint: fingerprint }).includes('zk-test'), false);
  const sandbox = dockerClientEnv(env);
  assert.equal(sandbox.ZAI_API_KEY, undefined);
  assert.equal(sandbox.ZAI_BASE_URL, undefined);
});

test('cli:claude-zai is gone and cli:claude never receives an Anthropic endpoint or token', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bin-'));
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { HOME: '/home/inert', PATH: bin, ZAI_API_KEY: 'zk-stale', ANTHROPIC_AUTH_TOKEN: 'at-stale', ANTHROPIC_BASE_URL: 'https://relay.invalid' };
  const ctx = { bridgeArgs: [], env, runtimeAdapter: () => '/tmp/adapter.js' };
  const removed = parseReviewerSpec('cli:claude-zai:glm-5.3');
  assert.equal(families.check(removed).code, 'PROVIDER_UNKNOWN');
  assert.throws(() => families.launch(removed, { ...ctx, workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'claude-zai-')) }), (error) => error.code === 'PROVIDER_UNKNOWN');
  assert.equal(removed.vendor, 'claude-zai', 'no vendor table entry: an unknown cli provider is not mapped to a model trainer');
  const plain = families.launch(parseReviewerSpec('cli:claude:opus'), { ...ctx, workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'claude-plain-')) });
  assert.equal(plain.sessionMeta.claudeCode.options.settings, undefined);
  const flaggedBin = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-flag-bin-'));
  fs.writeFileSync(path.join(flaggedBin, 'claude'), '#!/bin/sh\nif [ "$1" = auth ]; then echo "--settings"; fi\nexit 0\n', { mode: 0o755 });
  const flagged = families.launch(parseReviewerSpec('cli:claude:opus'), { ...ctx, env: { ...env, PATH: flaggedBin }, workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'claude-flagged-')) });
  assert.equal(flagged.sessionMeta.claudeCode.options.settings.forceLoginMethod, 'claudeai');
  assert.equal(plain.invocation.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(plain.invocation.env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(plain.invocation.env.ZAI_API_KEY, undefined);
  assert.deepEqual(families.envAllowlist(parseReviewerSpec('cli:claude:opus')), []);
  assert.equal(families.fingerprintEnv(parseReviewerSpec('cli:claude:opus')), null);
});
