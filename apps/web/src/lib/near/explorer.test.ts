import { describe, expect, it } from 'vitest';
import { accountUrlFor, txUrlFor } from './explorer';

describe('explorer urls', () => {
  it('builds sandbox tx and account urls on the local explorer origin', () => {
    const hash = '3w5Q0p1sandboxAttestHash';
    expect(txUrlFor('http://127.0.0.1:3031', hash)).toBe('http://127.0.0.1:3031/txns/3w5Q0p1sandboxAttestHash');
    expect(accountUrlFor('http://127.0.0.1:3031', 'alice.test.near')).toBe('http://127.0.0.1:3031/address/alice.test.near');
  });

  it('keeps testnet and mainnet on the same paths of the configured origin', () => {
    expect(txUrlFor('https://testnet.nearblocks.io', 'abc')).toBe('https://testnet.nearblocks.io/txns/abc');
    expect(accountUrlFor('https://nearblocks.io', 'registry.near')).toBe('https://nearblocks.io/address/registry.near');
  });
});
