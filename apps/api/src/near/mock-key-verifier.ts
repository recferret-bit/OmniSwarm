// Test and local-stack verifier (KEY_VERIFIER=mock; refused when NODE_ENV=production). A key nobody
// registered is a full-access key, so a real wallet can sign in on a local stack with no RPC; the NEP-413
// signature is still verified. `register` pins a key to a lower permission, or to `null` (no such key).
import type { AccountKeyVerifier, KeyPermission } from './key-verifier.ts';

export class MockAccountKeyVerifier implements AccountKeyVerifier {
  readonly kind = 'mock';
  readonly #keys = new Map<string, KeyPermission | null>();

  register(accountId: string, publicKey: string, permission: KeyPermission | null): void {
    this.#keys.set(`${accountId}\n${publicKey}`, permission);
  }

  async keyPermission(accountId: string, publicKey: string): Promise<KeyPermission | null> {
    const pinned = this.#keys.get(`${accountId}\n${publicKey}`);
    return pinned === undefined ? 'FullAccess' : pinned;
  }
}
