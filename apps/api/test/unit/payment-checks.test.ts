// The contract-side payment checks (payment.service.ts checkChainRequest), which the tx lookup cannot reach: the
// chain finds a transaction only for the account that signed it, so a foreign signer shows up here instead.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkChainRequest } from '../../src/modules/payments/payment.service.ts';
import { AppError } from '../../src/shared/errors.ts';

const row = { account: 'alice.testnet', price_yocto: '1000' } as never;
const held = (patch: Record<string, unknown> = {}) => ({ status: 'Pending', account: 'alice.testnet', depositYocto: 1000n, ...patch }) as never;
const refused = (chainRequest: unknown) => { try { checkChainRequest(row, chainRequest as never); return null; } catch (error) { return error instanceof AppError ? error.code : String(error); } };

test('a request held for another account is a signer mismatch (403), however much was deposited', () => {
  assert.equal(refused(held({ account: 'mallory.testnet' })), 'PAYMENT_SIGNER_MISMATCH');
  assert.equal(refused(held({ account: 'mallory.testnet', depositYocto: 10n ** 30n })), 'PAYMENT_SIGNER_MISMATCH');
});

test('an absent, running or underfunded request is a mismatch, and a matching pending one passes with its deposit', () => {
  assert.equal(refused(null), 'PAYMENT_MISMATCH');
  assert.equal(refused(held({ status: 'Running' })), 'PAYMENT_MISMATCH');
  assert.equal(refused(held({ depositYocto: 999n })), 'PAYMENT_MISMATCH');
  assert.equal(checkChainRequest(row, held({ depositYocto: 1500n })), 1500n);
  assert.equal(checkChainRequest(row, held()), 1000n);
});
