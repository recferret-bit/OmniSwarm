import { describe, expect, it } from 'vitest';
import { NATIVE_USDC, parseEnv, type RawEnv } from './env';

const VALID: RawEnv = {
  network: 'testnet', contractId: 'review-registry.omniswarm.testnet', intakeRecipient: 'omniswarm.testnet',
  rpcUrl: 'https://test.rpc.fastnear.com/', explorerUrl: 'https://testnet.nearblocks.io', wallet: 'real', apiMock: '0',
};

describe('parseEnv', () => {
  it('parses the public env contract', () => {
    expect(parseEnv(VALID)).toEqual({
      network: 'testnet', contractId: 'review-registry.omniswarm.testnet', intakeRecipient: 'omniswarm.testnet',
      rpcUrl: 'https://test.rpc.fastnear.com', explorerUrl: 'https://testnet.nearblocks.io', wallet: 'real', apiMock: false,
      donationAccount: null, donationUsdcContract: NATIVE_USDC.testnet,
    });
  });

  it.each<[Partial<RawEnv>, RegExp]>([
    [{ network: undefined }, /NEXT_PUBLIC_NETWORK is not set/],
    [{ network: 'devnet' }, /testnet, mainnet or sandbox/],
    [{ contractId: 'Not An Account' }, /NEXT_PUBLIC_CONTRACT_ID/],
    [{ rpcUrl: 'http://rpc.example' }, /https URL/],
    [{ network: 'mainnet', rpcUrl: 'http://127.0.0.1:3030' }, /https URL/],
    [{ wallet: 'injected' }, /real, mock or local/],
    [{ donationAccount: 'Not An Account' }, /NEXT_PUBLIC_DONATION_ACCOUNT is not a NEAR account id/],
    [{ donationUsdcContract: 'usdc contract' }, /NEXT_PUBLIC_DONATION_USDC_CONTRACT is not a NEAR account id/],
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

  describe('donations', () => {
    it('stay hidden when NEXT_PUBLIC_DONATION_ACCOUNT is unset or empty', () => {
      expect(parseEnv(VALID).donationAccount).toBeNull();
      expect(parseEnv({ ...VALID, donationAccount: '' }).donationAccount).toBeNull();
      expect(parseEnv({ ...VALID, donationAccount: '  ' }).donationAccount).toBeNull();
    });

    it('takes the recipient account and the native USDC contract of the network', () => {
      expect(parseEnv({ ...VALID, donationAccount: 'omniswarm.testnet' })).toMatchObject({
        donationAccount: 'omniswarm.testnet',
        donationUsdcContract: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
      });
      expect(parseEnv({ ...VALID, network: 'mainnet', donationAccount: 'omniswarm.near' }).donationUsdcContract)
        .toBe('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
    });

    it('has no default USDC contract on the sandbox, and an override wins on every network', () => {
      const sandbox = { ...VALID, network: 'sandbox', rpcUrl: 'http://127.0.0.1:3030', explorerUrl: 'http://127.0.0.1:3031', donationAccount: 'omniswarm.test.near' };
      expect(parseEnv(sandbox).donationUsdcContract).toBeNull();
      expect(parseEnv({ ...sandbox, donationUsdcContract: 'usdc.test.near' }).donationUsdcContract).toBe('usdc.test.near');
      expect(parseEnv({ ...VALID, donationUsdcContract: '' }).donationUsdcContract).toBe(NATIVE_USDC.testnet);
    });
  });
});
