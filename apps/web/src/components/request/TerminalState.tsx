import type { RequestStatusResponse } from '@/lib/api/schema.gen';
import { Alert } from '../ui/Alert';

export function TerminalState({ status }: { status: RequestStatusResponse }) {
  if (status.status !== 'failed') return null;
  if (status.failureCause) return <Alert>{status.failureCause}</Alert>;
  return <Alert>The review could not finish{status.progress?.phase ? ` (during ${status.progress.phase})` : ''}. Nothing was charged: reviews run on your own NEAR AI key.</Alert>;
}
