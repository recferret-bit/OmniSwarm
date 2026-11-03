import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../packages/schemas/index.mjs';

test('a reviewer report validates and an unknown family is rejected', () => {
  const sample = {
    reviewer: { id: 'key-zai-glm-5-3', family: 'key', provider: 'zai', vendor: 'zai', model: 'glm-5.3' },
    status: 'COMPLETE', gaps: [], surfaces: ['S1'], findings: [], verified_safe: [],
  };
  assert.equal(validate('reviewer-report', sample).ok, true);
  assert.equal(validate('reviewer-report', { ...sample, reviewer: { ...sample.reviewer, family: 'foo' } }).ok, false);
});
