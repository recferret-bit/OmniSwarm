// Worker process wiring: `review` jobs with WORKER_CONCURRENCY local slots, the dead-letter queue and
// the maintenance cron. pg-boss heartbeats each active job while its handler runs; a worker that dies
// stops heartbeating and the supervisor re-queues the job for another worker (retryLimit).
import type { PgBoss } from '../queue/boss.ts';
import { assertRefundJob, assertReviewJob, MAINTENANCE_QUEUE, REFUND_QUEUE, REVIEW_DEAD_QUEUE, REVIEW_QUEUE } from '../queue/review-queue.ts';
import type { PaymentDeps } from '../modules/payments/payment.service.ts';
import { refundRequest } from '../modules/payments/settlement.service.ts';
import { isAppError } from '../shared/errors.ts';
import { runMaintenance } from './maintenance.ts';
import { handleDeadReview, handleReview, type HandlerDeps } from './review-handler.ts';

/** `shutdown` aborts every running engine at once (SIGTERM is forwarded to the engine's process group). */
export async function startWorker(boss: PgBoss, deps: HandlerDeps & PaymentDeps, shutdown: AbortSignal = new AbortController().signal): Promise<void> {
  const { concurrency } = deps.config.queue;
  await boss.work(REVIEW_QUEUE, { batchSize: 1, localConcurrency: concurrency, pollingIntervalSeconds: 1 }, async ([job]) => {
    if (!job) return null;
    const data = assertReviewJob(job.data);
    const log = deps.log.child({ requestId: data.requestId, jobId: job.id, attempt: job.retryCount + 1 });
    log.info('review job started');
    try {
      const result = await handleReview({ ...deps, log }, data, { retryCount: job.retryCount, signal: AbortSignal.any([job.signal, shutdown]) });
      log.info({ result: result.status }, 'review job finished');
      return result;
    } catch (error) {
      log.warn({ err: error }, 'review job failed; pg-boss will retry or dead-letter it');
      throw error;
    }
  });
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
