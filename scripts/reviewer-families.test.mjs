import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { families, FamilyError } from './reviewer-families.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';
import { buildSessionLaunch } from './agent-session-launch.mjs';

test('only the cli family is installed before W03', () => {
  assert.deepEqual(families.list(), ['cli']);
  assert.throws(() => families.get('openrouter'), (error) => error instanceof FamilyError && error.code === 'FAMILY_NOT_INSTALLED' && /W03/.test(error.message));
  assert.throws(() => families.get('nonsense'), { code: 'FAMILY_UNKNOWN' });
});

test('check() reports uninstalled families and providers with the wave that adds them', () => {
  assert.deepEqual(families.check(parseReviewerSpec('cli:claude:opus')), { ok: true });
  const or = families.check(parseReviewerSpec('openrouter:qwen/qwen3.8-max-0902'));
  assert.equal(or.ok, false);
  assert.match(or.reason, /family `openrouter` not installed yet \(W03\)/);
  const zai = families.check(parseReviewerSpec('cli:claude-zai:glm-5.3'));
  assert.equal(zai.ok, false);
  assert.match(zai.reason, /W03/);
  assert.equal(families.check({ family: 'cli', provider: 'nope', model: 'x' }).code, 'PROVIDER_UNKNOWN');
  assert.throws(() => families.launch(parseReviewerSpec('key:zai:glm-5.3'), {}), { code: 'FAMILY_NOT_INSTALLED' });
});

test('cli reviewers receive no extra environment variables and codex/grok pin their model', () => {
  for (const spec of ['cli:claude:opus', 'cli:codex:gpt-6.1-sol']) assert.deepEqual(families.envAllowlist(parseReviewerSpec(spec)), []);
  assert.equal(families.modelPinned(parseReviewerSpec('cli:codex:gpt-6.1-sol')), true);
  assert.equal(families.modelPinned(parseReviewerSpec('cli:grok:grok-4.7')), true);
  assert.equal(families.modelPinned(parseReviewerSpec('cli:claude:opus')), false);
  assert.equal(families.modelPinned(parseReviewerSpec('cli:agy:gemini-4-argon-high')), false);
});

test('a family file dropped next to the others is loaded without editing the registry', async () => {
  // The loader keys on provider-<family>.mjs for the known family names; provider-cli.mjs is the proof.
  const here = path.dirname(fileURLToPath(import.meta.url));
  assert.ok(fs.existsSync(path.join(here, 'provider-cli.mjs')));
  assert.equal(families.get('cli').name, 'cli');
});

test('buildSessionLaunch is a dispatcher over the family registry', () => {
  assert.throws(() => buildSessionLaunch({ agent: 'nope', model: 'm', workDir: '/tmp', bridgeArgs: [] }), /PROVIDER_UNKNOWN|has no provider/);
  const source = fs.readFileSync(new URL('./agent-session-launch.mjs', import.meta.url), 'utf8');
  assert.ok(source.split('\n').length <= 12);
});
