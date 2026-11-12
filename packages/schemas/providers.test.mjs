import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS, accountPresetName, accountPresetProvider, accountProviders, apiProviders, envForSpec,
  isModelId, providerById, providerEnvNames, providerOfSpec, specFor,
} from './providers.mjs';
import { loadSchema } from './index.mjs';

test('the catalog names local CLIs and NEAR AI Cloud only', () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ['local', 'nearai']);
  const api = apiProviders();
  assert.deepEqual(api.map((p) => p.id), ['nearai']);
  // No two providers share a key variable, a spec prefix or a base URL.
  for (const field of ['keyEnv', 'specPrefix', 'baseUrl']) assert.equal(new Set(api.map((p) => p[field])).size, api.length, field);
  for (const p of api) {
    assert.ok(p.envAllowlist.includes(p.keyEnv), `${p.id} allow-list holds its key`);
    for (const other of api) if (other !== p) assert.ok(!p.envAllowlist.some((name) => other.envAllowlist.includes(name)), `${p.id} shares a variable with ${other.id}`);
    assert.match(p.baseUrl, /^https:\/\//);
    assert.ok(p.dataPolicy.length > 20);
  }
  assert.deepEqual(providerEnvNames(), ['NEARAI_API_KEY']);
});

test('a provider whose key can come from an account has a fixed base URL', () => {
  assert.deepEqual(accountProviders().map((p) => p.id), ['nearai']);
  for (const p of accountProviders()) {
    assert.equal(p.baseUrlEnv, null, `${p.id} must not take a base URL override`);
    assert.equal(p.transport, 'openai-chat');
  }
  // No provider takes an operator key from the admin page: the hosted service runs only on an account's own key.
  for (const p of PROVIDERS) assert.ok(!p.keySources.includes('admin-page'), `${p.id} takes an admin-page key`);
});

test('every family and spec prefix in the catalog is one the reviewer-spec schema accepts', () => {
  const schema = loadSchema('reviewer-spec');
  const families = JSON.stringify(schema);
  const pattern = new RegExp(schema.oneOf?.find((s) => s.type === 'string')?.pattern ?? schema.$defs?.spec?.pattern ?? '^$');
  for (const p of apiProviders()) {
    assert.ok(families.includes(`"${p.family}"`), `${p.family} in the schema`);
    assert.match(specFor(p.id, 'org/model-1.0'), pattern);
  }
});

test('specs map back to their provider and to only that provider\'s variables', () => {
  assert.equal(providerOfSpec('cli:claude:opus'), 'local');
  assert.equal(providerOfSpec('key:zai:glm-5.3'), null);
  assert.equal(providerOfSpec('openrouter:qwen/qwen3.8-max-0902#qwen'), null);
  assert.equal(providerOfSpec('nearai:deepseek-ai/DeepSeek-V4'), 'nearai');
  assert.equal(providerOfSpec('scripted:lazy'), null);
  assert.equal(providerOfSpec('key:anthropic:claude-opus-5-5'), null);
  assert.deepEqual(envForSpec('nearai:m'), ['NEARAI_API_KEY']);
  assert.deepEqual(envForSpec('cli:claude-zai:glm-5.3'), []);
  assert.deepEqual(envForSpec('openrouter:qwen/qwen3.8-max-0902'), []);
  assert.deepEqual(envForSpec('cli:claude:opus'), []);
  assert.throws(() => specFor('local', 'm'), /unknown API provider/);
  assert.throws(() => specFor('nearai', 'a b'), /invalid model id/);
  assert.equal(isModelId('deepseek-ai/DeepSeek-V4'), true);
  assert.equal(isModelId('a,b'), false);
  assert.equal(providerById('nope'), null);
});

test('account presets are account-<provider> and only for account providers', () => {
  assert.equal(accountPresetName('nearai'), 'account-nearai');
  assert.match(accountPresetName('nearai'), /^[a-z0-9-]{1,40}$/);
  assert.throws(() => accountPresetName('zai'), /does not take account keys/);
  assert.equal(accountPresetProvider('account-nearai'), 'nearai');
  assert.equal(accountPresetProvider('account-zai'), null);
  assert.equal(accountPresetProvider('panel'), null);
});

test('the public half carries no key variable name or base URL, so the browser bundle never does', async () => {
  const fs = await import('node:fs');
  const text = fs.readFileSync(new URL('./providers-public.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /[A-Z]+_API_KEY|_BASE_URL|https?:\/\//);
  const { PUBLIC_PROVIDERS } = await import('./providers-public.mjs');
  assert.deepEqual(PUBLIC_PROVIDERS.map((p) => p.id), PROVIDERS.map((p) => p.id));
  for (const p of PUBLIC_PROVIDERS) assert.equal(Object.hasOwn(p, 'keyEnv'), false);
});
