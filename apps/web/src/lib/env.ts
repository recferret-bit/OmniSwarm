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
}

export type RawEnv = Record<keyof Env, string | undefined>;

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
