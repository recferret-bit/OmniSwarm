// Worker process wiring: `review` jobs with WORKER_CONCURRENCY local slots, the dead-letter queue and
// the maintenance cron. pg-boss heartbeats each active job while its handler runs; a worker that dies
// stops heartbeating and the supervisor re-queues the job for another worker (retryLimit).
import type { PgBoss } from '../queue/boss.ts';
import { assertReviewJob, MAINTENANCE_QUEUE, REVIEW_DEAD_QUEUE, REVIEW_QUEUE } from '../queue/review-queue.ts';
import type { PaymentDeps } from '../modules/payments/payment.service.ts';
import { runMaintenance } from './maintenance.ts';
import { handleDeadReview, handleReview, type HandlerDeps } from './review-handler.ts';

export async function startWorker(boss: PgBoss, deps: HandlerDeps & PaymentDeps): Promise<void> {
  const { concurrency } = deps.config.queue;
  await boss.work(REVIEW_QUEUE, { batchSize: 1, localConcurrency: concurrency, pollingIntervalSeconds: 1 }, async ([job]) => {
    if (!job) return null;
    const data = assertReviewJob(job.data);
    const log = deps.log.child({ requestId: data.requestId, jobId: job.id, attempt: job.retryCount + 1 });
    log.info('review job started');
    try {
      const result = await handleReview({ ...deps, log }, data, { retryCount: job.retryCount, signal: job.signal });
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
  await boss.work(MAINTENANCE_QUEUE, { batchSize: 1, pollingIntervalSeconds: 5 }, async () => runMaintenance(deps));
  await boss.schedule(MAINTENANCE_QUEUE, '* * * * *', {}, { singletonKey: 'maintenance' });
}
