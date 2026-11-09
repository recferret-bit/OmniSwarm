// The wallet surface the app uses. The real implementation wraps
// @hot-labs/near-connect; a test-key connector replaces it only when the build
// sets NEXT_PUBLIC_WALLET=mock. near-connect only knows mainnet and testnet, so
// it is not used for NEXT_PUBLIC_WALLET=local (the dev wallet signs instead).
// The literal env comparisons below are folded by the bundler, so a production
// build never emits the mock or dev-wallet chunk.
import { AppError } from '../api/errors';
import type { PaymentTransaction } from './payment';

export interface SignMessageInput {
  message: string;
  recipient: string;
  nonce: Uint8Array;
}

export interface SignedMessage {
  accountId: string;
  publicKey: string;
  // NEP-413: base64 of the 64-byte ed25519 signature over sha256(payload).
  signature: string;
}

export interface WalletConnector {
  restore(): Promise<string | null>;
  /** Dev wallet only. The home page uses this to list seeded accounts. */
  listAccounts?(): Promise<Array<{ accountId: string; publicKey: string }>>;
  connect(accountId?: string): Promise<string>;
  signOut(): Promise<void>;
  signMessage(input: SignMessageInput): Promise<SignedMessage>;
  signAndSendTransaction(tx: PaymentTransaction): Promise<{ txHash: string }>;
  onSignOut(listener: () => void): () => void;
}

let instance: Promise<WalletConnector> | null = null;

export function getConnector(): Promise<WalletConnector> {
  if (!instance) {
    instance = process.env.NEXT_PUBLIC_WALLET === 'mock'
      ? import('../../mocks/wallet').then((mod) => mod.createMockConnector())
      : process.env.NEXT_PUBLIC_WALLET === 'local'
        ? import('./dev-wallet').then((mod) => mod.createDevWallet())
        : import('./near-connector').then((mod) => mod.createNearConnector());
  }
  return instance;
}

const REJECTION = /reject|cancel|denied|declined|closed by user|user closed/i;

// Wallets report a user cancel with different names and messages; the app
// needs one answer: was it the user (offer Retry) or something else.
export function normalizeWalletError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'UserRejected' || REJECTION.test(message)) return new AppError('WALLET_REJECTED');
  return new AppError('WALLET_UNAVAILABLE', message || undefined);
}
