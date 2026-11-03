// Worker process wiring: `review` jobs with WORKER_CONCURRENCY local slots, the dead-letter queue and
// the maintenance cron. pg-boss heartbeats each active job while its handler runs; a worker that dies
// stops heartbeating and the supervisor re-queues the job for another worker (retryLimit). A worker
// that is shut down gracefully hands its jobs back without spending a retry (releaseReview).
import type { JobWithMetadata } from 'pg-boss';
import { withTransaction } from '../db/pool.ts';
import type { PgBoss } from '../queue/boss.ts';
import {
  assertRefundJob, assertReviewJob, MAINTENANCE_QUEUE, REFUND_QUEUE, releaseReview, REVIEW_DEAD_QUEUE, REVIEW_QUEUE, type ReviewJob,
} from '../queue/review-queue.ts';
import type { PaymentDeps } from '../modules/payments/payment.service.ts';
import { refundRequest } from '../modules/payments/settlement.service.ts';
import { isAppError } from '../shared/errors.ts';
import { runMaintenance } from './maintenance.ts';
import { handleDeadReview, handleReview, RunInterruptedError, type HandlerDeps } from './review-handler.ts';

type WorkerDeps = HandlerDeps & PaymentDeps;

/**
 * Deliveries of `review` jobs. `shutdown` aborts every running engine at once (SIGTERM is forwarded to
 * the engine's process group); the interrupted job is then released with its retries intact, so a
 * deploy or restart never costs a request its retry.
 */
async function workReviews(boss: PgBoss, deps: WorkerDeps, shutdown: AbortSignal): Promise<void> {
  const options = { batchSize: 1, localConcurrency: deps.config.queue.concurrency, pollingIntervalSeconds: 1, includeMetadata: true } as const;
  await boss.work(REVIEW_QUEUE, options, async ([job]: JobWithMetadata<ReviewJob>[]) => {
    if (!job) return null;
    const data = assertReviewJob(job.data);
    const log = deps.log.child({ requestId: data.requestId, jobId: job.id, delivery: job.retryCount + 1 });
    log.info('review job started');
    try {
      const result = await handleReview({ ...deps, log }, data, {
        lastAttempt: job.retryCount >= job.retryLimit, signal: AbortSignal.any([job.signal, shutdown]),
      });
      log.info({ result: result.status }, 'review job finished');
      return result;
    } catch (error) {
      if (error instanceof RunInterruptedError && shutdown.aborted) {
        const attempt = { id: job.id, retryCount: job.retryCount, retryLimit: job.retryLimit };
        if (await withTransaction(deps.pool, (tx) => releaseReview(boss, tx, attempt, data))) {
          log.info('worker shutdown: review job handed back with its retries intact');
          return { status: 'released' };
        }
      }
      log.warn({ err: error }, 'review job failed; pg-boss will retry or dead-letter it');
      throw error;
    }
  });
}

export async function startWorker(boss: PgBoss, deps: WorkerDeps, shutdown: AbortSignal = new AbortController().signal): Promise<void> {
  await workReviews(boss, deps, shutdown);
  await boss.work(REVIEW_DEAD_QUEUE, { batchSize: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    if (!job) return null;
    const data = assertReviewJob(job.data);
    deps.log.warn({ requestId: data.requestId }, 'review job exhausted its retries; settling it');
    return handleDeadReview(deps, data);
  });
  // Chain writes the API asked for: the API process holds no operator key (INTAKE section 5).
  await boss.work(REFUND_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
    if (!job) return null;
    const data = assertRefundJob(job.data);
    try {
      return await refundRequest(deps, data.requestId, { actor: 'admin', cause: 'admin' });
    } catch (error) {
      // The request moved on (for example it completed) before the refund ran: nothing to retry.
      if (isAppError(error, 'REFUND_NOT_ALLOWED')) {
        deps.log.warn({ requestId: data.requestId }, 'admin refund skipped: no longer refundable');
        return { skipped: true };
      }
      throw error;
    }
  });
  await boss.work(MAINTENANCE_QUEUE, { batchSize: 1, pollingIntervalSeconds: 5 }, async () => runMaintenance(deps));
  await boss.schedule(MAINTENANCE_QUEUE, '* * * * *', {}, { singletonKey: 'maintenance' });
}
