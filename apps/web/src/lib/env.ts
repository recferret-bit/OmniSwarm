// Public build-time configuration. Every NEXT_PUBLIC_* value is read with a
// literal `process.env.NAME` so Next inlines it into the bundle; parseEnv then
// fails the build (or the test) when a value is malformed. OmniSwarm talks to
// NEAR mainnet only: @hot-labs/near-connect needs no RPC or explorer setting,
// and the explorer origin is a constant (lib/near/explorer.ts).

export interface Env {
  wallet: 'real' | 'mock';
  apiMock: boolean;
  /** NEP-413 `recipient` the wallet signs the sign-in message for. Must equal the API's recipient. */
  loginRecipient: string;
  /** NEAR account that receives optional USDC donations. null hides every donation section. */
  donationAccount: string | null;
  /** NEP-141 native USDC contract for the wallet donation. */
  donationUsdcContract: string;
}

export interface RawEnv {
  wallet?: string | undefined;
  apiMock?: string | undefined;
  loginRecipient?: string | undefined;
  donationAccount?: string | undefined;
  donationUsdcContract?: string | undefined;
}

// Native USDC on NEAR mainnet (Circle). Bridged USDC.e is a different contract and is never the default.
export const NATIVE_USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const DEFAULT_LOGIN_RECIPIENT = 'omniswarm.near';

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;

function account(name: string, value: string): string {
  if (!ACCOUNT_ID.test(value)) throw new Error(`${name} is not a NEAR account id`);
  return value;
}

// Optional account: unset or empty (a Docker ARG with no value) falls back, anything else must be an account id.
function optionalAccount(name: string, value: string | undefined): string | null {
  const text = value?.trim();
  return text ? account(name, text) : null;
}

export function parseEnv(raw: RawEnv): Env {
  const wallet = raw.wallet || 'real';
  if (wallet !== 'real' && wallet !== 'mock') throw new Error('NEXT_PUBLIC_WALLET must be real or mock');
  return {
    wallet,
    apiMock: raw.apiMock === '1',
    loginRecipient: optionalAccount('NEXT_PUBLIC_INTAKE_RECIPIENT', raw.loginRecipient) ?? DEFAULT_LOGIN_RECIPIENT,
    donationAccount: optionalAccount('NEXT_PUBLIC_DONATION_ACCOUNT', raw.donationAccount),
    donationUsdcContract: optionalAccount('NEXT_PUBLIC_DONATION_USDC_CONTRACT', raw.donationUsdcContract) ?? NATIVE_USDC,
  };
}

export const env: Env = parseEnv({
  wallet: process.env.NEXT_PUBLIC_WALLET,
  apiMock: process.env.NEXT_PUBLIC_API_MOCK,
  loginRecipient: process.env.NEXT_PUBLIC_INTAKE_RECIPIENT,
  donationAccount: process.env.NEXT_PUBLIC_DONATION_ACCOUNT,
  donationUsdcContract: process.env.NEXT_PUBLIC_DONATION_USDC_CONTRACT,
});

// Code that imports mock modules does not branch on `env`: it compares the
// literal `process.env.NEXT_PUBLIC_API_MOCK === '1'` (or NEXT_PUBLIC_WALLET)
// at the import site, which the bundler folds so the mock chunk is never emitted
// in a production build. `npm run guard` proves that on the built output.
