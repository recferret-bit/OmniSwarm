// Wallet session. The connector instance lives in lib/near/connector (a module
// ref), never in store state, so it stays out of devtools and persistence.
import { create } from 'zustand';
import type { AppErrorCode } from '@/lib/api/errors';
import { getConnector, normalizeWalletError, type WalletConnector } from '@/lib/near/connector';

export type WalletStatus = 'idle' | 'restoring' | 'connecting' | 'connected' | 'error';

export interface WalletState {
  status: WalletStatus;
  accountId: string | null;
  error: AppErrorCode | null;
  restore(): Promise<void>;
  connect(accountId?: string): Promise<void>;
  signOut(): Promise<void>;
}

export function createWalletStore(connector: () => Promise<WalletConnector> = getConnector) {
  return create<WalletState>()((set, get) => {
    let unsubscribe: (() => void) | null = null;
    const listen = (wallet: WalletConnector) => {
      unsubscribe?.();
      unsubscribe = wallet.onSignOut(() => set({ status: 'idle', accountId: null, error: null }));
    };
    return {
      status: 'idle',
      accountId: null,
      error: null,
      async restore() {
        if (get().status !== 'idle') return;
        set({ status: 'restoring' });
        const wallet = await connector();
        listen(wallet);
        const accountId = await wallet.restore();
        set(accountId ? { status: 'connected', accountId, error: null } : { status: 'idle', accountId: null });
      },
      async connect(chosen?: string) {
        set({ status: 'connecting', error: null });
        try {
          const wallet = await connector();
          listen(wallet);
          const accountId = await wallet.connect(chosen);
          set({ status: 'connected', accountId, error: null });
        } catch (error) {
          set({ status: 'error', accountId: null, error: normalizeWalletError(error).code });
        }
      },
      async signOut() {
        const wallet = await connector();
        await wallet.signOut();
        set({ status: 'idle', accountId: null, error: null });
      },
    };
  });
}

export const useWallet = createWalletStore();

export const selectAccountId = (state: WalletState) => state.accountId;
export const selectWalletStatus = (state: WalletState) => state.status;
export const selectIsConnected = (state: WalletState) => state.status === 'connected' && state.accountId !== null;
