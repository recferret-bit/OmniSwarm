import { env } from '../env';

// Every network uses the configured explorer origin and these paths.
// The sandbox stack sets that origin to http://127.0.0.1:3031.
export function txUrlFor(explorerUrl: string, hash: string): string {
  return `${explorerUrl}/txns/${encodeURIComponent(hash)}`;
}

export function accountUrlFor(explorerUrl: string, accountId: string): string {
  return `${explorerUrl}/address/${encodeURIComponent(accountId)}`;
}

export function txUrl(hash: string): string {
  return txUrlFor(env.explorerUrl, hash);
}

export function accountUrl(accountId: string): string {
  return accountUrlFor(env.explorerUrl, accountId);
}
