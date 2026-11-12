// Characterization of every API provider preset. The values come from the provider catalog
// (packages/schemas/providers.mjs); this test pins what each provider actually sends so a catalog edit
// that changes behaviour is a visible test change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, presetFor } from './provider-openai-compat.mjs';

test('each API provider preset sends exactly its own base URL, key variable, body and headers', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), ['nearai', 'openrouter', 'zai']);
  const zai = presetFor('zai');
  assert.equal(zai.baseUrl({}), 'https://api.z.ai/api/paas/v4');
  assert.equal(zai.baseUrl({ ZAI_BASE_URL: 'https://example.invalid/v4/' }), 'https://example.invalid/v4');
  assert.equal(zai.keyEnv, 'ZAI_API_KEY');
  assert.deepEqual(zai.envAllowlist, ['ZAI_API_KEY', 'ZAI_BASE_URL']);
  assert.deepEqual(zai.extraBody, { reasoning_effort: 'high' });
  assert.deepEqual(zai.headers({}), {});

  const openrouter = presetFor('openrouter');
  assert.equal(openrouter.baseUrl({ OPENROUTER_BASE_URL: 'https://evil.invalid' }), 'https://openrouter.ai/api/v1');
  assert.equal(openrouter.keyEnv, 'OPENROUTER_API_KEY');
  assert.deepEqual(openrouter.envAllowlist, ['OPENROUTER_API_KEY']);
  assert.deepEqual(openrouter.extraBody, { provider: { require_parameters: true, data_collection: 'deny' } });
  assert.deepEqual(openrouter.headers({}), { 'HTTP-Referer': 'https://omniswarm.dev', 'X-OpenRouter-Title': 'OmniSwarm' });

  const nearai = presetFor('nearai');
  assert.equal(nearai.baseUrl({ NEARAI_BASE_URL: 'https://evil.invalid' }), 'https://cloud-api.near.ai/v1');
  assert.equal(nearai.keyEnv, 'NEARAI_API_KEY');
  assert.deepEqual(nearai.envAllowlist, ['NEARAI_API_KEY']);
  assert.deepEqual(nearai.extraBody, {});
  assert.deepEqual(nearai.headers({}), {});
  assert.throws(() => presetFor('local'), /unknown provider/);
});
