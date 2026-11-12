import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectFetch } from './http-replay.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'provider-fixtures', 'w03');

test('replay serves the recorded nearai turns and a live call without OMNI_LIVE fails before the network', async () => {
  const fetch = selectFetch({ env: { OMNI_HTTP_REPLAY: FIXTURE }, provider: 'nearai' });
  const first = await fetch('https://example.invalid', { method: 'POST' });
  const body = await first.json();
  assert.equal(body.model, 'Qwen/Qwen3.8-Max');
  assert.equal(body.choices[0].message.tool_calls[0].function.name, 'read_file');
  const blocked = selectFetch({ env: {}, provider: 'nearai' });
  await assert.rejects(blocked('https://example.invalid', {}), (error) => error.code === 'LIVE_REQUIRED');
  assert.deepEqual(fs.readdirSync(FIXTURE), ['nearai'], 'recorded turns exist only for NEAR AI Cloud');
  const tree = fs.readdirSync(FIXTURE, { recursive: true }).filter((name) => String(name).endsWith('.json'));
  for (const name of tree) {
    const text = fs.readFileSync(path.join(FIXTURE, name), 'utf8');
    assert.doesNotMatch(text, /authorization|bearer/i);
  }
});
