// @ts-check
// Production AccountAgeSource over the NearBlocks public API (`GET /v1/account/{id}`). Off unless
// selected through `accountAgeFromConfig({ provider: 'nearblocks' })`. Tests inject `fetch`; nothing
// here is called against the real host in this repository.
//
// `network: 'sandbox'` is the local indexer, not a public NearBlocks host. It is accepted only when
// `baseUrl` is set, and that URL must not be api.nearblocks.io or api-testnet.nearblocks.io.
//
// Response shape (NearBlocks v1 reference, not checked against the live API from this repo; confirm
// before enabling): `{ account: [{ created: { block_timestamp: <ns, number or string> } }] }`.
// An empty `account` array, or a missing `created.block_timestamp`, means "unknown" (null).

/** @typedef {import('../types.js').AccountAgeSource} AccountAgeSource */

export const NEARBLOCKS_BASE = Object.freeze({ mainnet: 'https://api.nearblocks.io', testnet: 'https://api-testnet.nearblocks.io' });
const PUBLIC_HOSTS = new Set(Object.values(NEARBLOCKS_BASE).map((url) => new URL(url).host));
const DAY_MS = 86_400_000;

/**
 * @param {string} value
 * @returns {boolean}
 */
function isPublicNearBlocks(value) {
  let host;
  try {
    host = new URL(value).host;
  } catch {
    throw new TypeError('nearblocksAgeSource baseUrl must be an absolute URL');
  }
  return PUBLIC_HOSTS.has(host);
}

/**
 * @param {unknown} body
 * @returns {number | null} creation time in ms
 */
export function createdAtMsOf(body) {
  const list = /** @type {any} */ (body)?.account;
  if (!Array.isArray(list)) throw new TypeError('NearBlocks answer has no account list');
  const ns = list[0]?.created?.block_timestamp;
  if (ns === undefined || ns === null) return null;
  if (!/^\d{1,22}$/.test(String(ns))) throw new TypeError('NearBlocks created.block_timestamp is not nanoseconds');
  return Number(BigInt(String(ns)) / 1_000_000n);
}

/**
 * Creation times do not change, so known answers are cached (bounded, one day) to stay inside the
 * public rate limit. Unknown accounts and errors are not cached.
 * @param {{ network: 'mainnet' | 'testnet' | 'sandbox', apiKey?: string, fetch?: typeof fetch, baseUrl?: string, timeoutMs?: number, cacheSize?: number, now?: () => number }} options
 * @returns {AccountAgeSource}
 */
export function nearblocksAgeSource({ network, apiKey, fetch: fetchImpl = fetch, baseUrl, timeoutMs = 5000, cacheSize = 10_000, now = Date.now }) {
  if (network !== 'mainnet' && network !== 'testnet' && network !== 'sandbox') {
    throw new TypeError('nearblocksAgeSource needs network mainnet, testnet, or sandbox');
  }
  if (network === 'sandbox') {
    if (!baseUrl) throw new TypeError('nearblocksAgeSource sandbox needs an explicit baseUrl');
    if (isPublicNearBlocks(baseUrl)) throw new TypeError('nearblocksAgeSource sandbox must not call the public NearBlocks host');
  }
  const base = network === 'sandbox' ? baseUrl : (baseUrl ?? NEARBLOCKS_BASE[network]);
  if (!base) throw new TypeError('nearblocksAgeSource needs network mainnet or testnet');
  /** @type {Map<string, { at: number, until: number }>} */
  const cache = new Map();
  /** @type {Record<string, string>} */
  const headers = { accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };

  /** @param {string} accountId @param {number} at */
  function remember(accountId, at) {
    if (cache.size >= cacheSize) cache.delete(/** @type {string} */ (cache.keys().next().value));
    cache.set(accountId, { at, until: now() + DAY_MS });
  }

  return Object.freeze({
    getCreatedAtMs: async (/** @type {string} */ accountId) => {
      const hit = cache.get(accountId);
      if (hit && hit.until > now()) return hit.at;
      const url = new URL(`/v1/account/${encodeURIComponent(accountId)}`, base);
      /** @type {RequestInit} */
      const init = { headers, signal: AbortSignal.timeout(timeoutMs) };
      if (network === 'sandbox') init.redirect = 'error';
      const response = await fetchImpl(url, init);
      if (!response.ok) throw new Error(`NearBlocks answered ${response.status}`);
      const at = createdAtMsOf(await response.json());
      if (at !== null) remember(accountId, at);
      return at;
    },
  });
}
