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
  wallet: 'real' | 'mock';
  apiMock: boolean;
}

export type RawEnv = Record<keyof Env, string | undefined>;

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set (see apps/web/.env.example)`);
  return value;
}

function httpsUrl(name: string, value: string | undefined): string {
  const text = required(name, value).replace(/\/$/, '');
  if (!/^https:\/\/[^\s]+$/.test(text)) throw new Error(`${name} must be an https URL`);
  return text;
}

function account(name: string, value: string | undefined): string {
  const text = required(name, value);
  if (!ACCOUNT_ID.test(text)) throw new Error(`${name} is not a NEAR account id`);
  return text;
}

export function parseEnv(raw: RawEnv): Env {
  const network = required('NEXT_PUBLIC_NETWORK', raw.network);
  if (network !== 'testnet' && network !== 'mainnet') throw new Error('NEXT_PUBLIC_NETWORK must be testnet or mainnet');
  const wallet = raw.wallet || 'real';
  if (wallet !== 'real' && wallet !== 'mock') throw new Error('NEXT_PUBLIC_WALLET must be real or mock');
  return {
    network,
    contractId: account('NEXT_PUBLIC_CONTRACT_ID', raw.contractId),
    intakeRecipient: account('NEXT_PUBLIC_INTAKE_RECIPIENT', raw.intakeRecipient),
    rpcUrl: httpsUrl('NEXT_PUBLIC_RPC_URL', raw.rpcUrl),
    explorerUrl: httpsUrl('NEXT_PUBLIC_EXPLORER_URL', raw.explorerUrl),
    wallet,
    apiMock: raw.apiMock === '1',
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
});

// Code that imports mock modules does not branch on `env`: it compares the
// literal `process.env.NEXT_PUBLIC_API_MOCK === '1'` (or NEXT_PUBLIC_WALLET)
// at the import site, which the bundler folds so the mock chunk is never emitted
// in a production build. `npm run guard` proves that on the built output.
