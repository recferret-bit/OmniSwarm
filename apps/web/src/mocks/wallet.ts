// Dev/e2e only: MockConnector. A test ed25519 key (WebCrypto) produces real
// NEP-413 signatures over sha256(payload), base64-encoded as NEP-413 wallets
// return them; the public key is `ed25519:<base58>`. The bundle guard fails if
// `MockConnector` or a key-shaped `ed25519:` string reaches a production build.
import { b58encode, nep413Payload } from '@omniswarm/schemas/nep413';
import { AppError } from '@/lib/api/errors';
import type { SignMessageInput, WalletConnector } from '@/lib/near/connector';
import { bytesToBase64 } from '@/lib/near/nep413';
import type { WalletTransaction } from '@/lib/near/payment';
import { newTxHash, recordPayment } from './chain';
import { updateState } from './db';

export const MOCK_ACCOUNT = 'alice.testnet';
const SESSION_KEY = 'omniswarm.mock.wallet';

let keys: Promise<CryptoKeyPair> | null = null;

function keyPair(): Promise<CryptoKeyPair> {
  keys ??= crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
  return keys;
}

async function publicKey(): Promise<string> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', (await keyPair()).publicKey));
  return `ed25519:${b58encode(spki.slice(-32))}`;
}

function session(): Storage | null {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

export function createMockConnector(): WalletConnector {
  const listeners = new Set<() => void>();
  return {
    async restore() {
      return session()?.getItem(SESSION_KEY) ?? null;
    },
    async connect() {
      session()?.setItem(SESSION_KEY, MOCK_ACCOUNT);
      return MOCK_ACCOUNT;
    },
    async signOut() {
      session()?.removeItem(SESSION_KEY);
      listeners.forEach((listener) => listener());
    },
    async signMessage(input: SignMessageInput) {
      const payload = nep413Payload(input.message, input.nonce, input.recipient);
      const digest = await crypto.subtle.digest('SHA-256', payload);
      const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, (await keyPair()).privateKey, digest));
      return { accountId: MOCK_ACCOUNT, publicKey: await publicKey(), signature: bytesToBase64(signature) };
    },
    async signAndSendTransaction(tx: WalletTransaction) {
      const reject = updateState((state) => {
        const value = state.controls.walletReject;
        state.controls.walletReject = false;
        return value;
      });
      if (reject) {
        const error = new AppError('WALLET_REJECTED');
        error.name = 'UserRejected';
        throw error;
      }
      const action = tx.actions[0];
      const requestHash = action.params.args.request_hash;
      // Only a `request_review` call is a payment the mock intake looks up; anything else (a donation) just gets a hash.
      if (action.params.methodName !== 'request_review' || typeof requestHash !== 'string') return { txHash: newTxHash() };
      const txHash = recordPayment({ signer: MOCK_ACCOUNT, receiver: tx.receiverId, requestHash, deposit: action.params.deposit });
      return { txHash };
    },
    onSignOut(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
