// Local dev wallet (NEXT_PUBLIC_WALLET=local). near-connect only knows mainnet
// and testnet, so this module lists seeded sandbox accounts from the loopback
// indexer and signs with near-api-js. connector.ts loads it only behind a
// literal env comparison, so a real or mock build never emits this chunk.
import { Account, KeyPair, actions, type KeyPairString, type Provider } from 'near-api-js';
import { nep413Payload } from '@omniswarm/schemas/nep413';
import { AppError } from '../api/errors';
import { env } from '../env';
import { normalizeWalletError, type SignMessageInput, type SignedMessage, type WalletConnector } from './connector';
import { bytesToBase64 } from './nep413';
import type { PaymentTransaction } from './payment';

export interface DevAccount {
  accountId: string;
  publicKey: string;
  /** ed25519:base58 of the 64-byte secret key, the near-api-js form. */
  secretKey: string;
}

export interface DevAccountList {
  accounts: DevAccount[];
}

/** Enough of a near-api-js provider for one signed function call. Tests pass a stub. */
export interface DevRpc {
  viewAccessKey(params: { accountId: string; publicKey: { toString(): string } }): Promise<{ nonce: bigint; permission?: unknown }>;
  viewBlock(blockQuery: { finality: string }): Promise<{ header: { hash: string } }>;
  sendTransactionUntil(signedTransaction: unknown, waitUntil: string): Promise<unknown>;
}

export interface DevWalletOptions {
  /** `{ accounts }` from the indexer, or a function the test stubs. Skips the network. */
  accounts?: DevAccountList | DevAccount[] | (() => DevAccountList | DevAccount[] | Promise<DevAccountList | DevAccount[]>);
  /** Replaces global fetch so tests do not hit the network. */
  fetch?: typeof fetch;
  /** Indexer base URL. Defaults to DEV_WALLET_URL, then http://127.0.0.1:3031. */
  url?: string;
  /** near-api-js provider, or an RPC URL. Defaults to NEXT_PUBLIC_RPC_URL. */
  rpc?: DevRpc | string;
  /** Account that signs. Defaults to the session account, then the first listed one. */
  accountId?: string;
}

export interface DevWallet extends WalletConnector {
  listAccounts(): Promise<Array<Pick<DevAccount, 'accountId' | 'publicKey'>>>;
}

const SESSION_KEY = 'omniswarm.dev.wallet';
const DEFAULT_URL = 'http://127.0.0.1:3031';
const KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,128}$/;

function session(): Storage | null {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

function accountsUrl(base?: string): string {
  const configured = (base ?? process.env.DEV_WALLET_URL) || DEFAULT_URL;
  const trimmed = configured.replace(/\/$/, '');
  return trimmed.endsWith('/wallet/accounts') ? trimmed : `${trimmed}/wallet/accounts`;
}

function textField(row: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = row[name];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function parseAccounts(value: unknown): DevAccount[] {
  const accounts = (value as { accounts?: unknown } | null)?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('dev wallet returned no accounts');
  return accounts.map((item, index) => {
    const row = item as Record<string, unknown>;
    // The indexer serves near-cli key files: account_id, public_key, private_key.
    const accountId = textField(row, ['accountId', 'account_id']);
    const publicKey = textField(row, ['publicKey', 'public_key']);
    const secretKey = textField(row, ['secretKey', 'private_key', 'secret_key']);
    if (!accountId || !KEY.test(publicKey) || !KEY.test(secretKey)) {
      throw new Error(`dev wallet account ${index} is missing accountId, publicKey or an ed25519 secretKey`);
    }
    return { accountId, publicKey, secretKey };
  });
}

async function readAccounts(options: DevWalletOptions): Promise<DevAccount[]> {
  if (options.accounts) {
    const value = typeof options.accounts === 'function' ? await options.accounts() : options.accounts;
    return parseAccounts(Array.isArray(value) ? { accounts: value } : value);
  }
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    // The response carries dev secret keys. Do not let the browser cache it.
    response = await fetchImpl(accountsUrl(options.url), { cache: 'no-store' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'fetch failed';
    throw new Error(`dev wallet accounts could not be loaded (${reason})`);
  }
  if (!response.ok) throw new Error(`dev wallet accounts request failed (${response.status})`);
  return parseAccounts(await response.json());
}

function keyPairOf(account: DevAccount): KeyPair {
  let pair: KeyPair;
  try {
    pair = KeyPair.fromString(account.secretKey as KeyPairString);
  } catch {
    throw new AppError('WALLET_UNAVAILABLE', 'dev wallet secret key is not a near-api-js ed25519 key');
  }
  if (pair.getPublicKey().toString() !== account.publicKey) {
    throw new AppError('WALLET_UNAVAILABLE', 'dev wallet public key does not match its secret key');
  }
  return pair;
}

function txHashOf(outcome: unknown): string {
  const record = outcome as { transaction?: { hash?: unknown }; transaction_outcome?: { id?: unknown } } | null;
  const hash = record?.transaction?.hash ?? record?.transaction_outcome?.id;
  if (typeof hash !== 'string' || !hash) throw new AppError('WALLET_UNAVAILABLE', 'The dev wallet RPC did not return a transaction hash');
  return hash;
}

export function createDevWallet(options: DevWalletOptions = {}): DevWallet {
  const listeners = new Set<() => void>();
  let current: DevAccount | null = null;
  let pending: Promise<DevAccount[]> | null = null;

  function load(): Promise<DevAccount[]> {
    pending ??= readAccounts(options).catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  }

  async function selected(): Promise<DevAccount> {
    const accounts = await load();
    const wanted = options.accountId ?? current?.accountId ?? session()?.getItem(SESSION_KEY) ?? null;
    const account = accounts.find((item) => item.accountId === wanted) ?? (wanted && options.accountId ? null : accounts[0]);
    if (!account) throw new AppError('WALLET_UNAVAILABLE', wanted ? `dev wallet has no account ${wanted}` : 'The dev wallet returned no account');
    current = account;
    return account;
  }

  function nearAccount(account: DevAccount): Account {
    return new Account(account.accountId, (options.rpc ?? env.rpcUrl) as Provider | string, account.secretKey as KeyPairString);
  }

  return {
    async listAccounts() {
      const accounts = await load();
      return accounts.map(({ accountId, publicKey }) => ({ accountId, publicKey }));
    },
    async restore() {
      const saved = session()?.getItem(SESSION_KEY);
      if (!saved) return null;
      try {
        const accounts = await load();
        const account = accounts.find((item) => item.accountId === saved);
        if (!account) return null;
        current = account;
        return account.accountId;
      } catch {
        return null;
      }
    },
    async connect() {
      try {
        const account = await selected();
        session()?.setItem(SESSION_KEY, account.accountId);
        return account.accountId;
      } catch (error) {
        throw normalizeWalletError(error);
      }
    },
    async signOut() {
      current = null;
      pending = null;
      session()?.removeItem(SESSION_KEY);
      listeners.forEach((listener) => listener());
    },
    async signMessage(input: SignMessageInput): Promise<SignedMessage> {
      try {
        const account = await selected();
        const pair = keyPairOf(account);
        // NEP-413: the key signs sha256(payload). The payload bytes come from
        // @omniswarm/schemas/nep413, the same builder the intake verifies with.
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', nep413Payload(input.message, input.nonce, input.recipient)));
        const { signature } = pair.sign(digest);
        return { accountId: account.accountId, publicKey: pair.getPublicKey().toString(), signature: bytesToBase64(signature) };
      } catch (error) {
        throw normalizeWalletError(error);
      }
    },
    async signAndSendTransaction(tx: PaymentTransaction) {
      try {
        const account = await selected();
        const call = tx.actions[0];
        if (!call) throw new AppError('WALLET_UNAVAILABLE', 'The payment has no action');
        const outcome = await nearAccount(account).signAndSendTransaction({
          receiverId: tx.receiverId,
          actions: [actions.functionCall(call.params.methodName, call.params.args, BigInt(call.params.gas), BigInt(call.params.deposit))],
          waitUntil: 'FINAL',
        });
        return { txHash: txHashOf(outcome) };
      } catch (error) {
        throw normalizeWalletError(error);
      }
    },
    onSignOut(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
