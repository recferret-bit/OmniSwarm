import { describe, expect, it } from 'vitest';
import { parseEnv, type RawEnv } from './env';

const VALID: RawEnv = {
  network: 'testnet', contractId: 'review-registry.omniswarm.testnet', intakeRecipient: 'omniswarm.testnet',
  rpcUrl: 'https://test.rpc.fastnear.com/', explorerUrl: 'https://testnet.nearblocks.io', wallet: 'real', apiMock: '0',
};

describe('parseEnv', () => {
  it('parses the public env contract', () => {
    expect(parseEnv(VALID)).toEqual({
      network: 'testnet', contractId: 'review-registry.omniswarm.testnet', intakeRecipient: 'omniswarm.testnet',
      rpcUrl: 'https://test.rpc.fastnear.com', explorerUrl: 'https://testnet.nearblocks.io', wallet: 'real', apiMock: false,
    });
  });

  it.each<[Partial<RawEnv>, RegExp]>([
    [{ network: undefined }, /NEXT_PUBLIC_NETWORK is not set/],
    [{ network: 'devnet' }, /testnet or mainnet/],
    [{ contractId: 'Not An Account' }, /NEXT_PUBLIC_CONTRACT_ID/],
    [{ rpcUrl: 'http://rpc.example' }, /https URL/],
    [{ wallet: 'injected' }, /real or mock/],
  ])('fails on %j', (change, message) => {
    expect(() => parseEnv({ ...VALID, ...change })).toThrow(message);
  });
});
