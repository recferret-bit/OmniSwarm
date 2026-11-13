// Explorer links. OmniSwarm uses NEAR mainnet only, so the origin is a constant.
export const EXPLORER_URL = 'https://nearblocks.io';

export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/txns/${encodeURIComponent(hash)}`;
}

export function accountUrl(accountId: string): string {
  return `${EXPLORER_URL}/address/${encodeURIComponent(accountId)}`;
}
