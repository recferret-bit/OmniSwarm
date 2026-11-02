import test from 'node:test';
import assert from 'node:assert/strict';
import { anonymize } from './debate-anonymize.mjs';

test('the same seed anonymizes identically and hides model names', () => {
  const ids = ['scripted-baseline', 'scripted-paranoid', 'scripted-wrong'];
  const a = anonymize(ids, 7);
  const b = anonymize(ids, 7);
  const c = anonymize(ids, 8);
  assert.deepEqual(a.map, b.map);
  assert.notDeepEqual(a.map, c.map);
  assert.equal(JSON.stringify(a).match(/claude|codex|grok|glm|qwen|gemini/), null);
});
