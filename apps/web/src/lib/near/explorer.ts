import { env } from '../env';

export function txUrl(hash: string): string {
  return `${env.explorerUrl}/txns/${encodeURIComponent(hash)}`;
}

export function accountUrl(accountId: string): string {
  return `${env.explorerUrl}/address/${encodeURIComponent(accountId)}`;
}
