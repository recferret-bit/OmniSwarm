// @ts-check
// ChainReader over the local near-sandbox RPC. Registry views and view_account, no key, no broadcast.
import { registryReader, viewSourceMetadata } from '@omniswarm/guard';

const DEFAULT_CONTRACT = 'registry.test.near';

/**
 * @param {unknown} error
 */
function causeName(error) {
  if (!error || typeof error !== 'object') return '';
  const record = /** @type {{ cause?: { name?: unknown }, name?: unknown }} */ (error);
  if (typeof record.cause?.name === 'string') return record.cause.name;
  if (typeof record.name === 'string' && record.name !== 'HANDLER_ERROR') return record.name;
  return '';
}

/**
 * @param {unknown} error
 */
function isMissingMethod(error) {
  const name = causeName(error);
  if (name === 'MethodResolveError' || name === 'MethodNotFound') return true;
  const data = error && typeof error === 'object' ? /** @type {{ data?: unknown, message?: unknown }} */ (error).data : '';
  const message = error && typeof error === 'object' ? /** @type {{ message?: unknown }} */ (error).message : '';
  const text = `${typeof data === 'string' ? data : ''} ${typeof message === 'string' ? message : ''}`;
  return /MethodResolveError|MethodNotFound|method not found/i.test(text);
}

function isUnknownAccount(error) {
  const name = causeName(error);
  if (name === 'UNKNOWN_ACCOUNT' || name === 'INVALID_ACCOUNT') return true;
  const data = error && typeof error === 'object' ? /** @type {{ data?: unknown }} */ (error).data : '';
  return typeof data === 'string' && /does not exist while viewing|UNKNOWN_ACCOUNT/i.test(data);
}

/**
 * @param {unknown} result
 */
function decodeCall(result) {
  const raw = result && typeof result === 'object' ? /** @type {{ result?: unknown }} */ (result).result : undefined;
  let text = '';
  if (Array.isArray(raw)) text = Buffer.from(raw).toString('utf8');
  else if (typeof raw === 'string') text = Buffer.from(raw, 'base64').toString('utf8');
  else throw new Error('sandbox call_function result is missing');
  return JSON.parse(text);
}

/**
 * @param {{ rpcUrl: string, contractId?: string, fetch?: typeof fetch, timeoutMs?: number }} options
 */
export function createSandboxReader({ rpcUrl, contractId = DEFAULT_CONTRACT, fetch: fetchImpl = fetch, timeoutMs = 8000 }) {
  if (!rpcUrl) throw new TypeError('sandbox reader needs an RPC URL');

  /**
   * @param {string} method
   * @param {Record<string, unknown>} params
   */
  async function rpc(method, params) {
    const response = await fetchImpl(rpcUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'omniswarm-guard', method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`sandbox RPC answered ${response.status}`);
    const body = await response.json();
    if (!body || typeof body !== 'object') throw new Error('sandbox RPC answer is not JSON');
    return /** @type {{ result?: unknown, error?: unknown }} */ (body);
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} args
   */
  async function view(method, args) {
    const body = await rpc('query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args), 'utf8').toString('base64'),
    });
    if (body.error) {
      if (isUnknownAccount(body.error)) return null;
      throw new Error(`sandbox registry ${method} failed`);
    }
    return decodeCall(body.result);
  }

  /**
   * @param {string} accountId
   * @param {string} method
   * @param {Record<string, unknown>} args
   */
  async function viewAccountMethod(accountId, method, args) {
    const body = await rpc('query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: accountId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args), 'utf8').toString('base64'),
    });
    if (body.error) {
      if (isUnknownAccount(body.error) || isMissingMethod(body.error)) return null;
      throw new Error(`sandbox ${method} failed for ${accountId}`);
    }
    return decodeCall(body.result);
  }

  return Object.freeze({
    ...registryReader(view),
    getSourceMetadata: async (/** @type {string} */ accountId) => viewSourceMetadata(viewAccountMethod, accountId),
    getAccount: async (/** @type {string} */ accountId) => {
      const body = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
      if (body.error) {
        if (isUnknownAccount(body.error)) return null;
        throw new Error(`sandbox view_account failed for ${accountId}`);
      }
      const codeHash = body.result && typeof body.result === 'object'
        ? /** @type {{ code_hash?: unknown }} */ (body.result).code_hash
        : undefined;
      if (typeof codeHash !== 'string' || codeHash.length === 0) throw new Error(`sandbox view_account has no code_hash for ${accountId}`);
      return { codeHash };
    },
    getBlockTimestampMs: async (/** @type {number} */ height) => {
      const body = await rpc('block', { block_id: height });
      if (body.error) throw new Error(`sandbox block ${height} failed`);
      const header = body.result && typeof body.result === 'object'
        ? /** @type {{ header?: { timestamp_nanosec?: unknown } }} */ (body.result).header
        : undefined;
      const ns = header?.timestamp_nanosec;
      if (typeof ns !== 'string' && typeof ns !== 'number') throw new Error(`sandbox block ${height} has no timestamp`);
      if (!/^\d{1,22}$/.test(String(ns))) throw new Error(`sandbox block ${height} timestamp is not nanoseconds`);
      return Number(BigInt(String(ns)) / 1_000_000n);
    },
  });
}

/** Host RPC for this process. Default port 3030; NEAR_LOCAL_RPC_PORT overrides it. */
export function sandboxRpcUrl() {
  const port = process.env.NEAR_LOCAL_RPC_PORT || '3030';
  if (!/^\d+$/.test(port)) throw new TypeError('NEAR_LOCAL_RPC_PORT is not a port');
  return `http://127.0.0.1:${port}`;
}

/**
 * Local indexer base URL. GUARD_ACCOUNT_AGE_URL wins; otherwise the indexer port (default 3031).
 */
export function sandboxAgeUrl() {
  const explicit = process.env.GUARD_ACCOUNT_AGE_URL?.trim();
  if (explicit) return explicit;
  const port = process.env.NEAR_LOCAL_INDEXER_PORT || '3031';
  if (!/^\d+$/.test(port)) throw new TypeError('NEAR_LOCAL_INDEXER_PORT is not a port');
  return `http://127.0.0.1:${port}`;
}
