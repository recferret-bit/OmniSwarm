import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { families, FamilyError } from './reviewer-families.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';
import { buildSessionLaunch } from './agent-session-launch.mjs';

test('W03 installs key, openrouter and scripted; nearai stays uninstalled', () => {
  assert.deepEqual(families.list(), ['cli', 'key', 'openrouter', 'scripted']);
  assert.equal(families.get('openrouter').name, 'openrouter');
  assert.equal(families.get('key').transport, 'api-acp');
  assert.throws(() => families.get('nearai'), (error) => error instanceof FamilyError && error.code === 'FAMILY_NOT_INSTALLED' && /W03/.test(error.message));
  assert.throws(() => families.get('nonsense'), { code: 'FAMILY_UNKNOWN' });
});

test('check() accepts installed W03 providers and rejects an unknown key provider', () => {
  assert.deepEqual(families.check(parseReviewerSpec('cli:claude:opus')), { ok: true });
  assert.equal(families.check(parseReviewerSpec('openrouter:qwen/qwen3.8-max-0902')).ok, true);
  assert.equal(families.check(parseReviewerSpec('cli:claude-zai:glm-5.3')).ok, true);
  assert.equal(families.check(parseReviewerSpec('key:zai:glm-5.3')).ok, true);
  assert.equal(families.check(parseReviewerSpec('scripted:baseline')).ok, true);
  const unknown = families.check(parseReviewerSpec('key:foo:x'));
  assert.equal(unknown.code, 'PROVIDER_UNKNOWN');
  assert.match(unknown.reason, /unknown provider foo/);
  const deferred = families.check(parseReviewerSpec('key:openai:gpt-6.1-sol'));
  assert.equal(deferred.ok, false);
  assert.match(deferred.reason, /W03-05/);
  const or = parseReviewerSpec('openrouter:qwen/qwen3.8-max-0902');
  assert.equal(or.id, 'openrouter-qwen-qwen3-8-max-0902');
  assert.equal(or.vendor, 'alibaba');
  assert.deepEqual(parseReviewerSpec('cli:claude-zai:glm-5.3'), { id: 'cli-claude-zai-glm-5-3', family: 'cli', provider: 'claude-zai', vendor: 'zai', model: 'glm-5.3' });
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
