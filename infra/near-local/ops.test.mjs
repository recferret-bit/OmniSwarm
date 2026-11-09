import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseViewArgs } from './ops.mjs';

test('view accepts a method or an account plus a method', () => {
  assert.deepEqual(parseViewArgs(['get_config']), {
    account: 'registry.test.near', method: 'get_config', args: {},
  });
  assert.deepEqual(parseViewArgs(['registry', 'get_config']), {
    account: 'registry.test.near', method: 'get_config', args: {},
  });
  assert.deepEqual(parseViewArgs(['registry', 'get_attestation_for_account', '{"account":"drained-vault.test.near"}']), {
    account: 'registry.test.near',
    method: 'get_attestation_for_account',
    args: { account: 'drained-vault.test.near' },
  });
  assert.deepEqual(parseViewArgs(['get_price', '{}']), {
    account: 'registry.test.near', method: 'get_price', args: {},
  });
  assert.throws(() => parseViewArgs(['registry', 'get_config', 'not-json']), /JSON/);
  assert.throws(() => parseViewArgs([]), /usage/);
});
