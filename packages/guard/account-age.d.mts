import type { AccountAgeSource } from './types.js';

export interface NearBlocksAgeOptions {
  network: 'mainnet' | 'testnet';
  apiKey?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  cacheSize?: number;
  now?: () => number;
}

export const ACCOUNT_AGE_PROVIDERS: readonly ['off', 'nearblocks'];
export const NEARBLOCKS_BASE: Readonly<{ mainnet: string; testnet: string }>;
export function accountAgeFromConfig(config?: { provider?: string; network?: 'mainnet' | 'testnet'; apiKey?: string; fetch?: typeof fetch; baseUrl?: string }): AccountAgeSource | undefined;
export function nearblocksAgeSource(options: NearBlocksAgeOptions): AccountAgeSource;
export function createdAtMsOf(body: unknown): number | null;
