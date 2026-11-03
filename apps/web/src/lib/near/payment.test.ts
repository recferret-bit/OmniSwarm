import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors';
import { buildPaymentTx, formatNear, REQUEST_REVIEW_GAS } from './payment';

const HASH = 'ab'.repeat(32);
const ONE_NEAR = '1000000000000000000000000';

describe('request_review payment', () => {
  it('builds one FunctionCall to the build-time contract with the request hash and price', () => {
    const tx = buildPaymentTx({ contractId: 'review-registry.omniswarm.testnet', requestHash: HASH, priceYocto: ONE_NEAR });
    expect(tx).toEqual({
      receiverId: 'review-registry.omniswarm.testnet',
      actions: [{ type: 'FunctionCall', params: { methodName: 'request_review', args: { request_hash: HASH }, gas: REQUEST_REVIEW_GAS, deposit: ONE_NEAR } }],
    });
  });

  it('refuses a contract id from the API that differs from the build-time one', () => {
    const attempt = () => buildPaymentTx({ contractId: 'attacker.testnet', requestHash: HASH, priceYocto: ONE_NEAR });
    expect(attempt).toThrow(AppError);
    expect(attempt).toThrow(expect.objectContaining({ code: 'CONTRACT_MISMATCH' }));
  });

  it('rejects a malformed hash or a zero price', () => {
    expect(() => buildPaymentTx({ contractId: 'review-registry.omniswarm.testnet', requestHash: 'xyz', priceYocto: ONE_NEAR })).toThrow();
    expect(() => buildPaymentTx({ contractId: 'review-registry.omniswarm.testnet', requestHash: HASH, priceYocto: '0' })).toThrow();
  });

  it('formats yoctoNEAR', () => {
    expect(formatNear(ONE_NEAR)).toBe('1 NEAR');
    expect(formatNear('1500000000000000000000000')).toBe('1.5 NEAR');
  });
});
