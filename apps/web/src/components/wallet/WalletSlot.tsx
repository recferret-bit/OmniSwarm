'use client';

import { useEffect, useState } from 'react';
import { messageFor } from '@/lib/api/errors';
import { useWallet } from '@/stores/wallet';
import { Button } from '../ui/Button';
import { AccountChip } from './AccountChip';

// Rendered only after mount: the wallet session lives in the browser, so the
// server HTML always shows the connect button and hydration never mismatches.
export function WalletSlot() {
  const [mounted, setMounted] = useState(false);
  const status = useWallet((state) => state.status);
  const accountId = useWallet((state) => state.accountId);
  const error = useWallet((state) => state.error);
  const connect = useWallet((state) => state.connect);
  const signOut = useWallet((state) => state.signOut);

  useEffect(() => setMounted(true), []);

  async function onConnect() {
    await connect();
  }

  if (mounted && status === 'connected' && accountId) return <AccountChip accountId={accountId} onSignOut={() => void signOut()} />;
  return (
    <div className="wallet-slot">
      <Button onClick={() => void onConnect()} busy={mounted && (status === 'connecting' || status === 'restoring')}>
        Connect NEAR wallet
      </Button>
      {mounted && error ? <p className="wallet-slot__error" role="alert">{messageFor(error)}</p> : null}
    </div>
  );
}
