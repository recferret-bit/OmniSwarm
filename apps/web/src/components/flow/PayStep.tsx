'use client';

import Link from 'next/link';
import { formatNear } from '@/lib/near/payment';
import { selectCanPay, useRequestFlow } from '@/stores/request-flow';
import { Button } from '../ui/Button';

export function PayStep() {
  const step = useRequestFlow((state) => state.step);
  const request = useRequestFlow((state) => state.request);
  const position = useRequestFlow((state) => state.position);
  const canPay = useRequestFlow(selectCanPay);
  const pay = useRequestFlow((state) => state.pay);

  if (!request) return null;
  if (step === 'queued') {
    return (
      <div className="flow-step" role="status">
        <p>Payment confirmed — queued{position ? ` #${position}` : ''}.</p>
        <Link className="button button--secondary" href={`/r/${request.requestId}`}>Open status</Link>
      </div>
    );
  }
  if (step === 'confirming') return <p className="flow-step" role="status">Confirming payment on NEAR…</p>;
  if (step === 'paying') return <p className="flow-step" role="status">Waiting for your wallet…</p>;
  if (!canPay) return null;
  return (
    <div className="flow-step">
      <p>Pay through the review-registry contract. The deposit is refunded if the review cannot run.</p>
      <Button onClick={() => void pay()}>Pay {formatNear(request.priceYocto)}</Button>
    </div>
  );
}
