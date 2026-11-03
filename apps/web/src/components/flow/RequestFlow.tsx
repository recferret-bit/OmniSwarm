'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useRequestFlow } from '@/stores/request-flow';
import { selectAnnounce, useUi } from '@/stores/ui';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { FlowError } from './FlowError';
import { PayStep } from './PayStep';
import { QuoteCard } from './QuoteCard';
import { QuoteForm } from './QuoteForm';
import { SignedSummary } from './SignedSummary';
import { SignStep } from './SignStep';

const ANNOUNCE: Partial<Record<string, string>> = {
  quoted: 'Quote ready.', created: 'Request signed. Pay to start the review.', confirming: 'Confirming payment.', queued: 'Payment confirmed. Review queued.',
};

export function RequestFlow() {
  const router = useRouter();
  const step = useRequestFlow((state) => state.step);
  const quote = useRequestFlow((state) => state.quote);
  const signed = useRequestFlow((state) => state.signed);
  const requestId = useRequestFlow((state) => state.request?.requestId ?? null);
  const reset = useRequestFlow((state) => state.reset);
  const announce = useUi(selectAnnounce);

  const previous = useRef(step);

  useEffect(() => {
    const text = ANNOUNCE[step];
    if (text && previous.current !== step) announce(text);
    // Route on the transition only, not on every later visit with a queued request.
    if (step === 'queued' && previous.current === 'confirming' && requestId) router.push(`/r/${requestId}`);
    previous.current = step;
  }, [step, requestId, announce, router]);

  return (
    <Panel id="review" title="Review a repository">
      <QuoteForm />
      <FlowError />
      {quote ? <QuoteCard quote={quote} /> : null}
      <SignStep />
      {signed ? <SignedSummary signed={signed} /> : null}
      <PayStep />
      {step !== 'idle' ? <Button variant="ghost" onClick={reset}>Start over</Button> : null}
    </Panel>
  );
}
