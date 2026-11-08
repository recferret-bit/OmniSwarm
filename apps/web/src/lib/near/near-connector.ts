// Production wallet: @hot-labs/near-connect. Loaded only through getConnector(),
// which runs in the browser, because near-connect touches `window` on import.
import { NearConnector } from '@hot-labs/near-connect';
import { AppError } from '../api/errors';
import { env } from '../env';
import { normalizeWalletError, type SignMessageInput, type WalletConnector } from './connector';
import type { PaymentTransaction } from './payment';

function txHashOf(outcome: unknown): string {
  const record = outcome as { transaction?: { hash?: unknown }; transaction_outcome?: { id?: unknown } } | null;
  const hash = record?.transaction?.hash ?? record?.transaction_outcome?.id;
  if (typeof hash !== 'string' || !hash) throw new AppError('WALLET_UNAVAILABLE', 'The wallet did not return a transaction hash');
  return hash;
}

export function createNearConnector(): WalletConnector {
  const connector = new NearConnector({
    network: env.network,
    // NEAR Mobile's executor throws unless the network is mainnet, and its
    // manifest sets testnet: false. near-connect then omits it on testnet.
    // Do not force that flag; a listed wallet that cannot sign is a dead end.
    features: { signMessage: true, signAndSendTransaction: true },
  });

  async function wallet() {
    try {
      return await connector.wallet();
    } catch (error) {
      throw normalizeWalletError(error);
    }
  }

  return {
    async restore() {
      try {
        const { accounts } = await connector.getConnectedWallet();
        return accounts[0]?.accountId ?? null;
      } catch {
        return null;
      }
    },
    async connect() {
      try {
        const connected = await connector.connect();
        const accounts = await connected.getAccounts({ network: env.network });
        const accountId = accounts[0]?.accountId;
        if (!accountId) throw new AppError('WALLET_UNAVAILABLE', 'The wallet returned no account');
        return accountId;
      } catch (error) {
        throw normalizeWalletError(error);
      }
    },
    async signOut() {
      await connector.disconnect().catch(() => undefined);
    },
    async signMessage(input: SignMessageInput) {
      const active = await wallet();
      try {
        const signed = await active.signMessage({ ...input, network: env.network });
        return { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature };
      } catch (error) {
        throw normalizeWalletError(error);
      }
    },
    async signAndSendTransaction(tx: PaymentTransaction) {
      const active = await wallet();
      try {
        const outcome = await active.signAndSendTransaction({ network: env.network, receiverId: tx.receiverId, actions: tx.actions });
        return { txHash: txHashOf(outcome) };
      } catch (error) {
        throw normalizeWalletError(error);
      }
    },
    onSignOut(listener) {
      connector.on('wallet:signOut', listener);
      return () => connector.off('wallet:signOut', listener);
    },
  };
}
