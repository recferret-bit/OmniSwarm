// POST /api/requests/:id/payment with backoff while the transaction is not yet
// visible at FINAL (PAYMENT_NOT_FOUND, max 60 s). Re-sending the same txHash
// after a reload is idempotent: TX_ALREADY_USED means an earlier attempt landed,
// so the request's own status decides.
import type { Api } from '@/lib/api/client';
import { toAppError } from '@/lib/api/errors';

export const CONFIRM_DEADLINE_MS = 60_000;
const MAX_DELAY_MS = 8_000;

interface ConfirmDeps {
  api: Api;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export async function confirmWithBackoff(deps: ConfirmDeps, requestId: string, txHash: string): Promise<number | null> {
  const started = deps.now();
  for (let delay = 1_000; ; delay = Math.min(delay * 2, MAX_DELAY_MS)) {
    try {
      const response = await deps.api.confirmPayment(requestId, { txHash });
      return response.position;
    } catch (error) {
      const code = toAppError(error).code;
      if (code === 'TX_ALREADY_USED') {
        const status = await deps.api.getRequest(requestId);
        if (status.status !== 'awaiting_payment') return null;
        throw error;
      }
      if (code !== 'PAYMENT_NOT_FOUND' || deps.now() - started + delay > CONFIRM_DEADLINE_MS) throw error;
      await deps.sleep(delay);
    }
  }
}
