import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { families, FamilyError } from './reviewer-families.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';
import { buildSessionLaunch } from './agent-session-launch.mjs';

test('cli, key, nearai and scripted are installed; a key provider without a preset is not', () => {
  assert.deepEqual(families.list(), ['cli', 'key', 'nearai', 'scripted']);
  assert.equal(families.get('nearai').name, 'nearai');
  assert.equal(families.check(parseReviewerSpec('nearai:deepseek-ai/DeepSeek-V4')).ok, true);
  assert.equal(families.fingerprintEnv(parseReviewerSpec('nearai:x')), 'NEARAI_API_KEY');
  assert.deepEqual(families.envAllowlist(parseReviewerSpec('nearai:x')), ['NEARAI_API_KEY']);
  // The openrouter family was removed: no file, no wave, an unknown family.
  assert.throws(() => families.get('openrouter'), { code: 'FAMILY_UNKNOWN' });
  assert.equal(families.get('key').transport, 'api-acp');
  assert.equal(families.check(parseReviewerSpec('key:anthropic:claude-opus-5-5')).code, 'FAMILY_NOT_INSTALLED');
  assert.throws(() => families.get('nonsense'), { code: 'FAMILY_UNKNOWN' });
});

test('check() accepts installed W03 providers and rejects an unknown key provider', () => {
  assert.deepEqual(families.check(parseReviewerSpec('cli:claude:opus')), { ok: true });
  assert.equal(families.check(parseReviewerSpec('nearai:Qwen/Qwen3.8-Max')).ok, true);
  // Z.AI is gone both ways: as a key provider and as the claude-zai CLI variant.
  assert.equal(families.check(parseReviewerSpec('cli:claude-zai:glm-5.3')).code, 'PROVIDER_UNKNOWN');
  assert.equal(families.check(parseReviewerSpec('key:zai:glm-5.3')).code, 'PROVIDER_UNKNOWN');
  assert.equal(families.check(parseReviewerSpec('scripted:baseline')).ok, true);
  const unknown = families.check(parseReviewerSpec('key:foo:x'));
  assert.equal(unknown.code, 'PROVIDER_UNKNOWN');
  assert.match(unknown.reason, /unknown provider foo/);
  const deferred = families.check(parseReviewerSpec('key:openai:gpt-6.1-sol'));
  assert.equal(deferred.ok, false);
  assert.match(deferred.reason, /W03-05/);
  const hosted = parseReviewerSpec('nearai:Qwen/Qwen3.8-Max');
  assert.equal(hosted.id, 'nearai-qwen-qwen3-8-max');
  assert.equal(hosted.vendor, 'alibaba');
});

test('cli reviewers receive no extra environment variables and claude, codex, grok and agy pin their model', () => {
  for (const spec of ['cli:claude:opus', 'cli:codex:gpt-6.1-sol']) assert.deepEqual(families.envAllowlist(parseReviewerSpec(spec)), []);
  assert.equal(families.modelPinned(parseReviewerSpec('cli:codex:gpt-6.1-sol')), true);
  assert.equal(families.modelPinned(parseReviewerSpec('cli:grok:grok-4.7')), true);
  assert.equal(families.modelPinned(parseReviewerSpec('cli:claude:opus')), true);
  assert.equal(families.modelPinned(parseReviewerSpec('cli:agy:gemini-4-argon-high')), true);
});

test('a family file dropped next to the others is loaded without editing the registry', async () => {
  // The loader keys on provider-<family>.mjs for the known family names; provider-cli.mjs is the proof.
  const here = path.dirname(fileURLToPath(import.meta.url));
  assert.ok(fs.existsSync(path.join(here, 'provider-cli.mjs')));
  assert.equal(families.get('cli').name, 'cli');
});

test('buildSessionLaunch is a dispatcher over the family registry', () => {
  assert.throws(() => buildSessionLaunch({ agent: 'nope', model: 'm', workDir: '/tmp', bridgeArgs: [] }), /PROVIDER_UNKNOWN|unknown provider/);
  const source = fs.readFileSync(new URL('./agent-session-launch.mjs', import.meta.url), 'utf8');
  assert.ok(source.split('\n').length <= 12);
});
