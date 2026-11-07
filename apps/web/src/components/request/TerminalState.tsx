import type { RequestStatusResponse } from '@/lib/api/schema.gen';
import { txUrl } from '@/lib/near/explorer';
import { Alert } from '../ui/Alert';

export function TerminalState({ status }: { status: RequestStatusResponse }) {
  if (status.status === 'failed') {
    if (status.failureCause) return <Alert>{status.failureCause}</Alert>;
    return <Alert>The review could not finish{status.progress?.phase ? ` (during ${status.progress.phase})` : ''}. The deposit is being refunded.</Alert>;
  }
  if (status.status === 'refunded') {
    return (
      <Alert tone="warn" action={status.refundTx ? <a href={txUrl(status.refundTx)} target="_blank" rel="noreferrer">View the refund transaction</a> : null}>
        The review did not run to completion and the deposit was refunded.
      </Alert>
    );
  }
  return null;
}
