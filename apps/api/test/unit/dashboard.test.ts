// Dashboard chain gate and the funded dev key. The key in this file is generated here; it is not a seeded key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { KeyPair } from 'near-api-js';
import { assertDashboardChain } from '../../src/modules/dashboard/dashboard.service.ts';
import { loadFundedDevKey, requestReviewOnSandbox, sandboxPayerKeyPath } from '../../src/modules/dashboard/sandbox-payer.ts';
import { AppError } from '../../src/shared/errors.ts';

const ONE_NEAR = '1000000000000000000000000';
const HASH = 'ab'.repeat(32);

function appError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof AppError);
    return error;
  }
  assert.fail('expected AppError');
}

test('SANDBOX_PAYER_KEY_FILE is the key path when it is set', () => {
  const previous = process.env.SANDBOX_PAYER_KEY_FILE;
  process.env.SANDBOX_PAYER_KEY_FILE = '/secrets/bob.json';
  try {
    assert.equal(sandboxPayerKeyPath(), '/secrets/bob.json');
  } finally {
    if (previous === undefined) delete process.env.SANDBOX_PAYER_KEY_FILE;
    else process.env.SANDBOX_PAYER_KEY_FILE = previous;
  }
});

test('assertDashboardChain allows mock and sandbox near, and refuses near on testnet and mainnet', () => {
  assert.doesNotThrow(() => assertDashboardChain({ chain: { adapter: 'mock' } }));
  assert.doesNotThrow(() => assertDashboardChain({ chain: { adapter: 'mock' }, intake: { network: 'testnet' } }));
  assert.doesNotThrow(() => assertDashboardChain({ chain: { adapter: 'near' }, intake: { network: 'sandbox' } }));
  const testnet = appError(() => assertDashboardChain({ chain: { adapter: 'near' }, intake: { network: 'testnet' } }));
  assert.equal(testnet.code, 'FORBIDDEN');
  assert.equal(testnet.message, 'Dashboard jobs use the mock chain until NEAR sign-in is connected');
  const mainnet = appError(() => assertDashboardChain({ chain: { adapter: 'near' }, intake: { network: 'mainnet' } }));
  assert.equal(mainnet.code, 'FORBIDDEN');
  assert.equal(mainnet.message, 'Dashboard jobs use the mock chain until NEAR sign-in is connected');
});

test('a funded dev key file is not read off sandbox and is used on sandbox', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-dev-key-'));
  const file = path.join(dir, 'bob.json');
  const missing = path.join(dir, 'missing.json');
  try {
    const unread = appError(() => loadFundedDevKey('testnet', missing));
    assert.equal(unread.code, 'FORBIDDEN');
    assert.equal(appError(() => loadFundedDevKey('mainnet', missing)).code, 'FORBIDDEN');
    await assert.rejects(
      () => requestReviewOnSandbox({
        network: 'testnet', rpcUrls: ['http://127.0.0.1:1'], contractId: 'registry.test.near',
        requestHash: HASH, depositYocto: ONE_NEAR, keyPath: missing,
      }),
      (error: unknown) => error instanceof AppError && error.code === 'FORBIDDEN',
    );

    const pair = KeyPair.fromRandom('ed25519');
    const secret = pair.toString();
    const body = `${JSON.stringify({ account_id: 'bob.test.near', public_key: pair.getPublicKey().toString(), private_key: secret }, null, 2)}\n`;
    fs.writeFileSync(file, body, { mode: 0o600 });
    fs.chmodSync(file, 0o600);

    const read = mock.method(fs, 'readFileSync', () => {
      throw new Error('dev key was read');
    });
    const stat = mock.method(fs, 'statSync', () => {
      throw new Error('dev key was stat');
    });
    try {
      const error = appError(() => loadFundedDevKey('testnet', file));
      assert.equal(error.code, 'FORBIDDEN');
      assert.equal(error.message, 'A funded dev key is loaded only when the network is sandbox');
      assert.equal(read.mock.calls.length, 0);
      assert.equal(stat.mock.calls.length, 0);
    } finally {
      read.mock.restore();
      stat.mock.restore();
    }

    const loaded = loadFundedDevKey('sandbox', file);
    assert.equal(loaded.accountId, 'bob.test.near');
    assert.equal((await loaded.signer.getPublicKey()).toString(), pair.getPublicKey().toString());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
