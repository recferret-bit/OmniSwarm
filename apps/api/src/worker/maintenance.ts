// Cluster-wide housekeeping, run once a minute by whichever worker pg-boss's cron hands it to:
// the payment reconciler, pruning of expired nonces and rate-limit windows, and disk hygiene of the
// run and report dirs (worker/hygiene.ts; every worker shares RUNS_ROOT and REPORTS_ROOT on one host).
import type { Config } from '../config/load.ts';
import { pruneNonces } from '../db/repositories/nonces.ts';
import { pruneRateLimits } from '../db/repositories/rate-limits.ts';
import { reconcilePayments } from '../modules/payments/reconcile.service.ts';
import type { PaymentDeps } from '../modules/payments/payment.service.ts';
import { runHygiene, statusLookup } from './hygiene.ts';

export async function runMaintenance(deps: PaymentDeps & { config: Config }) {
  const reconciled = await reconcilePayments(deps);
  const nonces = await pruneNonces(deps.pool, new Date(deps.clock.now().getTime() - 24 * 3600 * 1000));
  const windows = await pruneRateLimits(deps.pool);
  const { storage } = deps.config;
  const disk = await runHygiene(storage, statusLookup(deps.pool), deps.clock.now().getTime());
  return { ...reconciled, prunedNonces: nonces, prunedWindows: windows, ...disk };
}
