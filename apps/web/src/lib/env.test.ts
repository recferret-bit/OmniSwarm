import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGIN_RECIPIENT, NATIVE_USDC, parseEnv } from './env';

describe('parseEnv', () => {
  it('defaults to the real wallet, no mock, no donations and the mainnet native USDC', () => {
    expect(parseEnv({})).toEqual({
      wallet: 'real', apiMock: false, loginRecipient: DEFAULT_LOGIN_RECIPIENT, donationAccount: null, donationUsdcContract: NATIVE_USDC,
    });
    expect(NATIVE_USDC).toBe('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
  });

  it('reads the mock switches', () => {
    expect(parseEnv({ wallet: 'mock', apiMock: '1' })).toMatchObject({ wallet: 'mock', apiMock: true });
  });

  it.each<[Parameters<typeof parseEnv>[0], RegExp]>([
    [{ wallet: 'injected' }, /real or mock/],
    [{ wallet: 'local' }, /real or mock/],
    [{ loginRecipient: 'Not An Account' }, /NEXT_PUBLIC_INTAKE_RECIPIENT/],
    [{ donationAccount: 'Not An Account' }, /NEXT_PUBLIC_DONATION_ACCOUNT is not a NEAR account id/],
    [{ donationUsdcContract: 'usdc contract' }, /NEXT_PUBLIC_DONATION_USDC_CONTRACT is not a NEAR account id/],
  ])('fails on %j', (raw, message) => {
    expect(() => parseEnv(raw)).toThrow(message);
  });

  describe('donations', () => {
    it('stay hidden when NEXT_PUBLIC_DONATION_ACCOUNT is unset or empty', () => {
      expect(parseEnv({}).donationAccount).toBeNull();
      expect(parseEnv({ donationAccount: '' }).donationAccount).toBeNull();
      expect(parseEnv({ donationAccount: '  ' }).donationAccount).toBeNull();
    });

    it('take the recipient account, and an override of the USDC contract wins over the default', () => {
      expect(parseEnv({ donationAccount: 'omniswarm.near' })).toMatchObject({ donationAccount: 'omniswarm.near', donationUsdcContract: NATIVE_USDC });
      expect(parseEnv({ donationUsdcContract: 'usdc.example.near' }).donationUsdcContract).toBe('usdc.example.near');
      expect(parseEnv({ donationUsdcContract: '' }).donationUsdcContract).toBe(NATIVE_USDC);
    });
  });
});
