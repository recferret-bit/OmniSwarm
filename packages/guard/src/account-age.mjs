// @ts-check
// `@omniswarm/guard/account-age`: the feature flag for the account-age signal. The default is
// `off`: no source, so the age is unavailable and the guard never answers `allow` without it.

import { nearblocksAgeSource } from './nearblocks-age.mjs';

export { nearblocksAgeSource, createdAtMsOf, NEARBLOCKS_BASE } from './nearblocks-age.mjs';

/** @typedef {import('../types.js').AccountAgeSource} AccountAgeSource */

export const ACCOUNT_AGE_PROVIDERS = Object.freeze(['off', 'nearblocks']);

/**
 * @param {{ provider?: string, network?: 'mainnet' | 'testnet', apiKey?: string, fetch?: typeof fetch, baseUrl?: string }} [config]
 * @returns {AccountAgeSource | undefined}  pass as `createGuard({ reader, accountAge })`
 */
export function accountAgeFromConfig({ provider = 'off', network, apiKey, fetch, baseUrl } = {}) {
  if (provider === 'off') return undefined;
  if (provider === 'nearblocks') {
    if (network !== 'mainnet' && network !== 'testnet') throw new TypeError('the nearblocks account age source needs network mainnet or testnet');
    return nearblocksAgeSource({ network, apiKey, fetch, baseUrl });
  }
  throw new TypeError(`unknown account age provider "${provider}" (expected ${ACCOUNT_AGE_PROVIDERS.join(' or ')})`);
}
