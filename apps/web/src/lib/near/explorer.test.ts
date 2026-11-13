import { describe, expect, it } from 'vitest';
import { accountUrl, txUrl } from './explorer';

describe('explorer urls', () => {
  it('builds mainnet nearblocks links', () => {
    expect(txUrl('3w5Q0p1abc')).toBe('https://nearblocks.io/txns/3w5Q0p1abc');
    expect(accountUrl('alice.near')).toBe('https://nearblocks.io/address/alice.near');
  });
});
