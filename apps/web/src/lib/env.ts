// Public build-time configuration. Every NEXT_PUBLIC_* value is read with a
// literal `process.env.NAME` so Next inlines it into the bundle; parseEnv then
// fails the build (or the test) when a value is missing or malformed.
import type { Network } from './api/schema.gen';

export interface Env {
  network: Network;
  contractId: string;
  intakeRecipient: string;
  rpcUrl: string;
  explorerUrl: string;
  wallet: 'real' | 'mock' | 'local';
  apiMock: boolean;
  /** NEAR account that receives optional USDC donations. null hides every donation section. */
  donationAccount: string | null;
  /** NEP-141 native USDC contract for the wallet donation. null (sandbox, no override) keeps only the manual address. */
  donationUsdcContract: string | null;
}

type OptionalRaw = 'donationAccount' | 'donationUsdcContract';
export type RawEnv = Record<Exclude<keyof Env, OptionalRaw>, string | undefined> & Partial<Record<OptionalRaw, string | undefined>>;

// Native USDC on NEAR (Circle). Bridged USDC.e is a different contract and is never the default.
export const NATIVE_USDC: Readonly<Record<Network, string | null>> = {
  mainnet: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  testnet: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
  sandbox: null,
};

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set (see apps/web/.env.example)`);
  return value;
}

// https on every network. Plain http is the local sandbox only (RPC :3030, indexer :3031).
function endpointUrl(name: string, value: string | undefined, network: string): string {
  const text = required(name, value).replace(/\/$/, '');
  if (/^https:\/\/[^\s]+$/.test(text)) return text;
  if (network === 'sandbox' && /^http:\/\/[^\s]+$/.test(text)) return text;
  throw new Error(`${name} must be an https URL`);
}

function account(name: string, value: string | undefined): string {
  const text = required(name, value);
  if (!ACCOUNT_ID.test(text)) throw new Error(`${name} is not a NEAR account id`);
  return text;
}

// Optional account: unset or empty (a Docker ARG with no value) is null, anything else must be an account id.
function optionalAccount(name: string, value: string | undefined): string | null {
  const text = value?.trim();
  return text ? account(name, text) : null;
}

export function parseEnv(raw: RawEnv): Env {
  const network = required('NEXT_PUBLIC_NETWORK', raw.network);
  if (network !== 'testnet' && network !== 'mainnet' && network !== 'sandbox') {
    throw new Error('NEXT_PUBLIC_NETWORK must be testnet, mainnet or sandbox');
  }
  const wallet = raw.wallet || 'real';
  if (wallet !== 'real' && wallet !== 'mock' && wallet !== 'local') {
    throw new Error('NEXT_PUBLIC_WALLET must be real, mock or local');
  }
  return {
    network,
    contractId: account('NEXT_PUBLIC_CONTRACT_ID', raw.contractId),
    intakeRecipient: account('NEXT_PUBLIC_INTAKE_RECIPIENT', raw.intakeRecipient),
    rpcUrl: endpointUrl('NEXT_PUBLIC_RPC_URL', raw.rpcUrl, network),
    explorerUrl: endpointUrl('NEXT_PUBLIC_EXPLORER_URL', raw.explorerUrl, network),
    wallet,
    apiMock: raw.apiMock === '1',
    donationAccount: optionalAccount('NEXT_PUBLIC_DONATION_ACCOUNT', raw.donationAccount),
    donationUsdcContract: optionalAccount('NEXT_PUBLIC_DONATION_USDC_CONTRACT', raw.donationUsdcContract) ?? NATIVE_USDC[network],
  };
}

export const env: Env = parseEnv({
  network: process.env.NEXT_PUBLIC_NETWORK,
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID,
  intakeRecipient: process.env.NEXT_PUBLIC_INTAKE_RECIPIENT,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL,
  wallet: process.env.NEXT_PUBLIC_WALLET,
  apiMock: process.env.NEXT_PUBLIC_API_MOCK,
  donationAccount: process.env.NEXT_PUBLIC_DONATION_ACCOUNT,
  donationUsdcContract: process.env.NEXT_PUBLIC_DONATION_USDC_CONTRACT,
});

// Code that imports mock modules does not branch on `env`: it compares the
// literal `process.env.NEXT_PUBLIC_API_MOCK === '1'` (or NEXT_PUBLIC_WALLET)
// at the import site, which the bundler folds so the mock chunk is never emitted
// in a production build. `npm run guard` proves that on the built output.
