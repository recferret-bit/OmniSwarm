// Cluster-wide housekeeping, run once a minute by whichever worker pg-boss's cron hands it to:
// the payment reconciler and pruning of expired nonces and rate-limit windows.
import { pruneNonces } from '../db/repositories/nonces.ts';
import { pruneRateLimits } from '../db/repositories/rate-limits.ts';
import { reconcilePayments } from '../modules/payments/reconcile.service.ts';
import type { PaymentDeps } from '../modules/payments/payment.service.ts';

export async function runMaintenance(deps: PaymentDeps) {
  const reconciled = await reconcilePayments(deps);
  const nonces = await pruneNonces(deps.pool, new Date(deps.clock.now().getTime() - 24 * 3600 * 1000));
  const windows = await pruneRateLimits(deps.pool);
  return { ...reconciled, prunedNonces: nonces, prunedWindows: windows };
}
