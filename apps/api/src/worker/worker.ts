// Worker process wiring: `review` jobs with WORKER_CONCURRENCY local slots, the dead-letter queue and
// the maintenance cron. pg-boss heartbeats each active job while its handler runs; a worker that dies
// stops heartbeating and the supervisor re-queues the job for another worker (retryLimit). A worker
// that is shut down gracefully hands its jobs back without spending a retry (releaseReview).
import type { JobWithMetadata } from 'pg-boss';
import { withTransaction } from '../db/pool.ts';
import type { PgBoss } from '../queue/boss.ts';
import {
  assertGuardReportJob, assertRefundJob, assertReviewJob, GUARD_REPORT_QUEUE, MAINTENANCE_QUEUE, REFUND_QUEUE, releaseReview,
  REVIEW_DEAD_QUEUE, REVIEW_QUEUE, type ReviewJob,
} from '../queue/review-queue.ts';
import { sendGuardReport } from '../modules/guard/guard-report.service.ts';
import type { PaymentDeps } from '../modules/payments/payment.service.ts';
import { refundRequest } from '../modules/payments/settlement.service.ts';
import { isAppError } from '../shared/errors.ts';
import { runMaintenance } from './maintenance.ts';
import { findRequest, transition } from '../db/repositories/requests.ts';
import { isPanelPreset } from './panel.ts';
import { finalReportDir, splitLargeReview } from './theme-split.ts';
import { beginPublishing, attestRequest } from '../modules/payments/settlement.service.ts';
import { publishReport } from './publish.ts';
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
      const existing = await findRequest(deps.pool, data.requestId);
      if (existing && !existing.theme && !existing.parent_id && deps.engine.kind === 'cli' && isPanelPreset(existing.preset)) {
        const split = await splitLargeReview({ pool: deps.pool, boss, clock: deps.clock, config: deps.config, row: existing });
        if (split === 'split') {
          log.info('large review queued as one job per theme');
          return { status: 'split' };
        }
        if (split === 'empty') {
          await transition(deps.pool, existing.id, {
            to: 'failed', patch: { failureCause: `No ${existing.scope} code found in this repository.` }, actor: 'worker', event: 'review_empty', now: deps.clock.now(),
          });
          return { status: 'failed', reason: `no ${existing.scope} code` };
        }
      }
      const result = await handleReview({ ...deps, log }, data, {
        lastAttempt: job.retryCount >= job.retryLimit, signal: AbortSignal.any([job.signal, shutdown]),
      });
      if (existing?.parent_id) {
        const final = await finalReportDir(deps.pool, deps.config, existing.parent_id);
        if (final) {
          const published = publishReport({
            reportsRoot: deps.config.storage.reportsRoot, requestId: final.parent.id, sourceDir: final.dir,
            repo: final.parent.repo, commitSha: final.parent.commit_sha, preset: final.parent.preset,
          });
          const reportUri = `${deps.config.storage.reportsBaseUrl}/${final.parent.id}/report.html`;
          try {
            await beginPublishing(deps, final.parent.id, { reportSha256: published.reportSha256, reportUri, maxSeverity: 'none', incomplete: false });
            await attestRequest(deps, final.parent.id, { reportUri, maxSeverity: 'none' });
            log.info({ parentId: final.parent.id }, 'final report published');
          } catch (error) {
            if (!isAppError(error, 'INVALID_TRANSITION')) throw error;
          }
        }
      }
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
  await boss.work(GUARD_REPORT_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
    if (!job) return null;
    return sendGuardReport(deps, assertGuardReportJob(job.data).reportId);
  });
  await boss.work(MAINTENANCE_QUEUE, { batchSize: 1, pollingIntervalSeconds: 5 }, async () => runMaintenance(deps));
  await boss.schedule(MAINTENANCE_QUEUE, '* * * * *', {}, { singletonKey: 'maintenance' });
}
