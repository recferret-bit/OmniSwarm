// Payment reconciler (W08-21): a client that paid but never called /payment still gets its review.
// For unpaid requests younger than 24 h, read get_request; a Pending request with enough deposit is
// marked paid (tx `reconciled:<hash>`) and enqueued. Older unpaid requests expire.
import { findRequest, awaitingPayment, transition } from '../../db/repositories/requests.ts';
import { isAppError } from '../../shared/errors.ts';
import { checkChainRequest, markPaid, type PaymentDeps } from './payment.service.ts';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function reconcilePayments(deps: PaymentDeps): Promise<{ queued: string[]; expired: string[] }> {
  const now = deps.clock.now();
  const queued: string[] = [];
  const expired: string[] = [];
  for (const row of await awaitingPayment(deps.pool)) {
    if (now.getTime() - row.created_at.getTime() > WINDOW_MS) {
      await transition(deps.pool, row.id, { to: 'expired', from: ['awaiting_payment'], actor: 'reconcile', event: 'expired', now }).then(
        () => expired.push(row.id), (error: unknown) => { if (!isAppError(error, 'INVALID_TRANSITION')) throw error; });
      continue;
    }
    const chainRequest = await deps.chain.getRequest(row.request_hash);
    if (!chainRequest) continue;
    try {
      const deposit = checkChainRequest(row, chainRequest);
      const fresh = await findRequest(deps.pool, row.id);
      if (fresh?.status !== 'awaiting_payment') continue;
      await markPaid(deps, fresh, { txHash: `reconciled:${row.request_hash}`, amountYocto: deposit, actor: 'reconcile', event: 'reconciled' });
      queued.push(row.id);
    } catch (error) {
      // Underpaid, wrong account or a race with /payment: leave it for the user or the next pass.
      if (!(error instanceof Error && isAppError(error))) throw error;
    }
  }
  return { queued, expired };
}
