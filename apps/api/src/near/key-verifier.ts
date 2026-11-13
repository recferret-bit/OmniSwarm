// The one thing NEAR wallet sign-in needs from the chain: is this public key a full-access key of the
// claimed account? A NEP-413 signature proves possession of a key, not that the key belongs to the account.
// Adapters: `rpc` (near-api-js view_access_key, failover across RPC_URLS) and `mock` (in memory, tests and
// the local stack only). There is no other chain access in this service.
import { FailoverRpcError, FailoverRpcProvider, JsonRpcProvider, type Provider } from 'near-api-js';
import { AccessKeyDoesNotExistError, AccountDoesNotExistError } from 'near-api-js/rpc-errors';
import { AppError } from '../shared/errors.ts';

export type KeyPermission = 'FullAccess' | 'FunctionCall';

export interface AccountKeyVerifier {
  readonly kind: 'rpc' | 'mock';
  /** The permission of `publicKey` on `accountId`, or null when the account or the key does not exist. */
  keyPermission(accountId: string, publicKey: string): Promise<KeyPermission | null>;
}

const FINAL = { finality: 'final' } as const;

/** Sign-in cannot be decided while the RPC is down: fail closed, retryable. */
export function keyLookupUnavailable(cause: unknown): AppError {
  return new AppError('INTERNAL', 'The NEAR account keys could not be read; try again shortly', { status: 503, cause });
}

function isNotFound(error: unknown): boolean {
  if (error instanceof FailoverRpcError) return error.errors.length > 0 && error.errors.every(isNotFound);
  return error instanceof AccountDoesNotExistError || error instanceof AccessKeyDoesNotExistError;
}

export function createProvider(urls: string[]): Provider {
  return new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url }, { retries: 2, wait: 100, backoff: 2 })));
}

export class RpcAccountKeyVerifier implements AccountKeyVerifier {
  readonly kind = 'rpc';
  readonly #provider: Provider;

  constructor(rpcUrls: string[], provider: Provider = createProvider(rpcUrls)) {
    this.#provider = provider;
  }

  async keyPermission(accountId: string, publicKey: string): Promise<KeyPermission | null> {
    try {
      const key = await this.#provider.viewAccessKey({ accountId, publicKey, finalityQuery: FINAL });
      return key.permission === 'FullAccess' ? 'FullAccess' : 'FunctionCall';
    } catch (error) {
      if (isNotFound(error)) return null;
      throw keyLookupUnavailable(error);
    }
  }
}
