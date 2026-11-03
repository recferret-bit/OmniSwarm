'use client';

import { selectCanSign, useRequestFlow } from '@/stores/request-flow';
import { selectAccountId, useWallet } from '@/stores/wallet';
import { Button } from '../ui/Button';

export function SignStep() {
  const accountId = useWallet(selectAccountId);
  const connect = useWallet((state) => state.connect);
  const canSign = useRequestFlow(selectCanSign);
  const signing = useRequestFlow((state) => state.step === 'signing');
  const sign = useRequestFlow((state) => state.sign);

  if (!canSign && !signing) return null;
  if (!accountId) {
    return (
      <div className="flow-step">
        <p>Connect a NEAR wallet to sign this request.</p>
        <Button onClick={() => void connect()}>Connect NEAR wallet</Button>
      </div>
    );
  }
  return (
    <div className="flow-step">
      <p>Your wallet signs the request message (NEP-413). No transaction is sent yet.</p>
      <Button busy={signing} onClick={() => void sign(accountId)}>Sign request</Button>
    </div>
  );
}
