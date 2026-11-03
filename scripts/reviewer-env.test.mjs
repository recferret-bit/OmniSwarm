import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { reviewerProcessEnv } from './reviewer-env.mjs';

test('a relative replay or record directory reaches the reviewer as an absolute path', () => {
  const env = reviewerProcessEnv({ PATH: '/bin', OMNI_HTTP_REPLAY: 'scripts/provider-fixtures/w03', OMNI_HTTP_RECORD: './rec', OMNI_LIVE: '0' }, [], '/operator/checkout');
  assert.equal(env.OMNI_HTTP_REPLAY, path.resolve('/operator/checkout', 'scripts/provider-fixtures/w03'));
  assert.equal(env.OMNI_HTTP_RECORD, '/operator/checkout/rec');
  assert.equal(env.OMNI_LIVE, '0');
  assert.equal(reviewerProcessEnv({ OMNI_HTTP_REPLAY: '/abs/fixtures' }, [], '/elsewhere').OMNI_HTTP_REPLAY, '/abs/fixtures');
});
