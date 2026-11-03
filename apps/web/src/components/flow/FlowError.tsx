'use client';

import { messageFor } from '@/lib/api/errors';
import { useRequestFlow } from '@/stores/request-flow';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';

// Inline repo validation is shown on the field itself; everything else here.
export function FlowError() {
  const error = useRequestFlow((state) => state.error);
  const pay = useRequestFlow((state) => state.pay);
  const confirm = useRequestFlow((state) => state.confirm);
  if (!error || error.code === 'REPO_INVALID') return null;

  const retry = error.stage === 'pay' && error.code !== 'CONTRACT_MISMATCH'
    ? <Button variant="secondary" onClick={() => void pay()}>Retry</Button>
    : error.stage === 'confirm'
      ? <Button variant="secondary" onClick={() => void confirm()}>Retry confirmation</Button>
      : null;
  return <Alert tone={error.code === 'QUEUE_FULL' ? 'warn' : 'bad'} action={retry}>{messageFor(error.code)}</Alert>;
}
