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
    [{ network: 'devnet' }, /testnet, mainnet or sandbox/],
    [{ contractId: 'Not An Account' }, /NEXT_PUBLIC_CONTRACT_ID/],
    [{ rpcUrl: 'http://rpc.example' }, /https URL/],
    [{ network: 'mainnet', rpcUrl: 'http://127.0.0.1:3030' }, /https URL/],
    [{ wallet: 'injected' }, /real, mock or local/],
  ])('fails on %j', (change, message) => {
    expect(() => parseEnv({ ...VALID, ...change })).toThrow(message);
  });

  it('allows wallet local', () => {
    expect(parseEnv({ ...VALID, wallet: 'local' }).wallet).toBe('local');
  });

  it('NEXT_PUBLIC_NETWORK=testnet with an http RPC throws', () => {
    expect(() => parseEnv({ ...VALID, network: 'testnet', rpcUrl: 'http://127.0.0.1:3030' })).toThrow(/https URL/);
  });

  it('NEXT_PUBLIC_NETWORK=sandbox with http://127.0.0.1:3030 and http://127.0.0.1:3031 is accepted', () => {
    expect(parseEnv({
      ...VALID,
      network: 'sandbox',
      contractId: 'registry.test.near',
      intakeRecipient: 'omniswarm.test.near',
      rpcUrl: 'http://127.0.0.1:3030',
      explorerUrl: 'http://127.0.0.1:3031/',
      wallet: 'local',
    })).toMatchObject({
      network: 'sandbox',
      contractId: 'registry.test.near',
      rpcUrl: 'http://127.0.0.1:3030',
      explorerUrl: 'http://127.0.0.1:3031',
      wallet: 'local',
    });
  });
});
