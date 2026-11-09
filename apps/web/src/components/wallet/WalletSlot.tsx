'use client';

import { useEffect, useState } from 'react';
import { messageFor } from '@/lib/api/errors';
import { getConnector } from '@/lib/near/connector';
import { useWallet } from '@/stores/wallet';
import { Button } from '../ui/Button';
import { AccountChip } from './AccountChip';

// Rendered only after mount: the wallet session lives in the browser, so the
// server HTML always shows the connect button and hydration never mismatches.
export function WalletSlot() {
  const [mounted, setMounted] = useState(false);
  const [choices, setChoices] = useState<string[] | null>(null);
  const status = useWallet((state) => state.status);
  const accountId = useWallet((state) => state.accountId);
  const error = useWallet((state) => state.error);
  const connect = useWallet((state) => state.connect);
  const signOut = useWallet((state) => state.signOut);

  useEffect(() => setMounted(true), []);

  async function onConnect() {
    try {
      const wallet = await getConnector();
      if (wallet.listAccounts) {
        const accounts = await wallet.listAccounts();
        if (accounts.length > 1) {
          setChoices(accounts.map((account) => account.accountId));
          return;
        }
      }
    } catch {
      // connect() reports the same failure on the store.
    }
    setChoices(null);
    await connect();
  }

  if (mounted && status === 'connected' && accountId) return <AccountChip accountId={accountId} onSignOut={() => void signOut()} />;
  return (
    <div className="wallet-slot">
      <Button onClick={() => void onConnect()} busy={mounted && (status === 'connecting' || status === 'restoring')}>
        Connect NEAR wallet
      </Button>
      {choices ? (
        <ul className="wallet-slot__accounts">
          {choices.map((id) => (
            <li key={id}>
              <Button variant="ghost" onClick={() => void connect(id)}>{id}</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {mounted && error ? <p className="wallet-slot__error" role="alert">{messageFor(error)}</p> : null}
    </div>
  );
}
