// Production wallet: @hot-labs/near-connect. Loaded only through getConnector(),
// which runs in the browser, because near-connect touches `window` on import.
import { NearConnector } from '@hot-labs/near-connect';
import { AppError } from '../api/errors';
import { normalizeWalletError, type SignMessageInput, type WalletConnector, type WalletTransaction } from './connector';

function txHashOf(outcome: unknown): string {
  const record = outcome as { transaction?: { hash?: unknown }; transaction_outcome?: { id?: unknown } } | null;
  const hash = record?.transaction?.hash ?? record?.transaction_outcome?.id;
  if (typeof hash !== 'string' || !hash) throw new AppError('WALLET_UNAVAILABLE', 'The wallet did not return a transaction hash');
  return hash;
}

// OmniSwarm runs on NEAR mainnet only.
const network = 'mainnet';

export function createNearConnector(): WalletConnector {
  const connector = new NearConnector({
    network,
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
        const accounts = await connected.getAccounts({ network });
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
        const signed = await active.signMessage({ ...input, network });
        return { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature };
      } catch (error) {
        throw normalizeWalletError(error);
      }
    },
    async signAndSendTransaction(tx: WalletTransaction) {
      const active = await wallet();
      try {
        const outcome = await active.signAndSendTransaction({ network, receiverId: tx.receiverId, actions: tx.actions });
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
