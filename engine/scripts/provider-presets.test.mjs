// Characterization of every API provider preset. The values come from the provider catalog
// (packages/schemas/providers.mjs); this test pins what each provider actually sends so a catalog edit
// that changes behaviour is a visible test change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, presetFor } from './provider-openai-compat.mjs';

test('each API provider preset sends exactly its own base URL, key variable, body and headers', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), ['nearai']);
  // Removed providers have no preset: nothing can send a request to their hosts.
  for (const removed of ['zai', 'openrouter']) assert.throws(() => presetFor(removed), /unknown provider/);

  const nearai = presetFor('nearai');
  assert.equal(nearai.baseUrl({ NEARAI_BASE_URL: 'https://evil.invalid' }), 'https://cloud-api.near.ai/v1');
  assert.equal(nearai.keyEnv, 'NEARAI_API_KEY');
  assert.deepEqual(nearai.envAllowlist, ['NEARAI_API_KEY']);
  assert.deepEqual(nearai.extraBody, {});
  assert.deepEqual(nearai.headers({}), {});
  assert.throws(() => presetFor('local'), /unknown provider/);
});
