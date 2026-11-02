import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReviewerRow } from './check-agents.mjs';

test('check-agents rows report a missing or present key and never the value', () => {
  const missing = checkReviewerRow('openrouter:qwen/qwen3.8-max-0902', {});
  assert.equal(missing.ok, false);
  assert.equal(missing.line, 'openrouter: OPENROUTER_API_KEY missing');
  const present = checkReviewerRow('openrouter:qwen/qwen3.8-max-0902', { OPENROUTER_API_KEY: 'or-test' });
  assert.equal(present.ok, true);
  assert.equal(present.line, 'openrouter: key present');
  assert.equal(present.line.includes('or-test'), false);
  assert.equal(checkReviewerRow('scripted:baseline', {}).line, 'scripted: ok');
  const zai = checkReviewerRow('key:zai:glm-5.3', {});
  assert.equal(zai.line, 'key:zai: ZAI_API_KEY missing');
});
