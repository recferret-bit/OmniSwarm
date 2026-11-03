// @ts-check
// Verdict source backed by the intake API's `GET /api/guard/verdict`. Any HTTP or shape
// failure throws, which the guard turns into a `warn` with SIGNAL_UNAVAILABLE.

import { assertVerdict } from './guard.mjs';

/**
 * @param {{ apiUrl: string, network: 'testnet' | 'mainnet', apiKey?: string, fetch?: typeof fetch }} options
 * @returns {(accountId: string) => Promise<import('../types.js').Verdict>}
 */
export function httpSource({ apiUrl, network, apiKey, fetch: fetchImpl = fetch }) {
  const base = new URL('/api/guard/verdict', apiUrl);
  return async (accountId) => {
    const url = new URL(base);
    url.searchParams.set('account', accountId);
    url.searchParams.set('network', network);
    /** @type {Record<string, string>} */
    const headers = { accept: 'application/json' };
    if (apiKey) headers['x-guard-key'] = apiKey;
    const response = await fetchImpl(url, { headers });
    if (!response.ok) throw new Error(`guard API answered ${response.status}`);
    return assertVerdict(await response.json());
  };
}
