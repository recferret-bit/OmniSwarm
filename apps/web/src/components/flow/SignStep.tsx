'use client';

import { useEffect, useState } from 'react';
import { accountPresetName } from '@omniswarm/schemas/providers-public';
import { api, type AccountKeyView } from '@/lib/api/client';
import { selectCanSign, useRequestFlow } from '@/stores/request-flow';
import { selectAccountId, useWallet } from '@/stores/wallet';
import { keyReady } from '../account/AccountKeyPanel';
import { Button } from '../ui/Button';

/**
 * Own-key providers this wallet's account can sign a request on: signed in as the same account (sid cookie
 * from an earlier request), a key and models saved on /me, and the operator allows it (ALLOWED_PRESETS).
 */
function useOwnKeys(accountId: string | null): AccountKeyView[] {
  const [views, setViews] = useState<AccountKeyView[]>([]);
  useEffect(() => {
    let live = true;
    setViews([]);
    if (!accountId) return undefined;
    void (async () => {
      try {
        const session = await api.session();
        if (session.account !== accountId) return;
        const { providers } = await api.listAccountKeys();
        if (live) setViews(providers.filter((view) => view.signedRequests && keyReady(view)));
      } catch { /* not signed in: the hosted panel is the only choice */ }
    })();
    return () => { live = false; };
  }, [accountId]);
  return views;
}

export function SignStep() {
  const accountId = useWallet(selectAccountId);
  const connect = useWallet((state) => state.connect);
  const canSign = useRequestFlow(selectCanSign);
  const signing = useRequestFlow((state) => state.step === 'signing');
  const sign = useRequestFlow((state) => state.sign);
  const own = useOwnKeys(accountId);
  const [choice, setChoice] = useState<string>('panel');

  if (!canSign && !signing) return null;
  if (!accountId) {
    return (
      <div className="flow-step">
        <p>Connect a NEAR wallet to sign this request.</p>
        <Button onClick={() => void connect()}>Connect NEAR wallet</Button>
      </div>
    );
  }
  const selected = own.find((view) => view.provider === choice);
  return (
    <div className="flow-step">
      {own.length > 0 ? (
        <fieldset className="quote-form">
          <legend>Review with</legend>
          <label>
            <input type="radio" name="sign-source" value="panel" checked={!selected} onChange={() => setChoice('panel')} />
            {' '}Hosted panel
          </label>
          {own.map((view) => (
            <label key={view.provider}>
              <input type="radio" name="sign-source" value={view.provider} checked={selected?.provider === view.provider} onChange={() => setChoice(view.provider)} />
              {' '}{view.label} (your key) · {view.models.join(', ')}
            </label>
          ))}
        </fieldset>
      ) : null}
      <p>Your wallet signs the request message (NEP-413). No transaction is sent yet.</p>
      <Button busy={signing} onClick={() => void sign(accountId, selected ? accountPresetName(selected.provider) : undefined)}>Sign request</Button>
    </div>
  );
}
