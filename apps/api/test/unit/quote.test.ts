import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../../src/config/load.ts';
import { priceFor } from '../../src/modules/quote/quote.service.ts';
import { isAppError } from '../../src/shared/errors.ts';

const ONE_NEAR = '1000000000000000000000000';
const BASE = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db', SESSION_SECRET: 's'.repeat(40), INTAKE_RECIPIENT: 'omniswarm.testnet', CONTRACT_ID: 'registry.testnet',
};

test('priceFor returns 1 NEAR for the sandbox default and NETWORK_DISABLED for an unpriced mainnet', () => {
  const sandbox = loadConfig('api', { ...BASE, CONTRACT_ID: undefined, NEAR_NETWORK: 'sandbox' });
  assert.equal(sandbox.intake.network, 'sandbox');
  assert.equal(sandbox.intake.contractId, 'registry.test.near');
  assert.equal(priceFor(sandbox, 'sandbox'), ONE_NEAR);
  assert.throws(() => priceFor(sandbox, 'testnet'), (error: unknown) => {
    assert.ok(isAppError(error, 'NETWORK_DISABLED'));
    return true;
  });

  const testnet = loadConfig('api', BASE);
  assert.equal(testnet.intake.priceYocto, ONE_NEAR);
  assert.equal(priceFor(testnet, 'testnet'), ONE_NEAR);

  const mainnet = loadConfig('api', { ...BASE, NETWORK: 'mainnet', CONTRACT_ID: 'registry.near' });
  assert.equal(mainnet.intake.priceYocto, null);
  assert.throws(() => priceFor(mainnet, 'mainnet'), (error: unknown) => {
    assert.ok(isAppError(error, 'NETWORK_DISABLED'));
    return true;
  });
});
