// The `review` queue (INTAKE section 3, W09-02). A job is sent inside the transaction that inserts the
// request, through pg-boss's `db` option, so "queued" and "enqueued" commit or roll back together.
// Policy `exclusive` + singletonKey=requestId: at most one queued-or-active job per request.
import { validate } from '@omniswarm/schemas';
import type { Config } from '../config/load.ts';
import type { Db } from '../db/pool.ts';
import type { PgBoss } from './boss.ts';

export const REVIEW_QUEUE = 'review';
/** Jobs that exhausted their retries (a worker died twice): settled as an infra failure. */
export const REVIEW_DEAD_QUEUE = 'review-dead';
export const MAINTENANCE_QUEUE = 'maintenance';
/** Queues of the removed on-chain features; `installQueues` deletes them from a database that still has them. */
const RETIRED_QUEUES = ['refund', 'guard-report'] as const;

export interface ReviewJob {
  requestId: string;
  repo: string;
  commitSha: string;
  preset: string;
}

export class JobContractError extends Error {
  override name = 'JobContractError';
}

/** packages/schemas/job.schema.json#/$defs/input, checked on send and again on fetch. */
export function assertReviewJob(data: unknown): ReviewJob {
  // A job queued before the payment fields were removed still carries requestHash and network: drop them.
  const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const job = { requestId: raw.requestId, repo: raw.repo, commitSha: raw.commitSha, preset: raw.preset };
  const result = validate('job#input', job);
  if (!result.ok) throw new JobContractError(`job payload rejected: ${result.errors.join('; ')}`);
  return job as ReviewJob;
}

export function reviewQueueOptions(config: Config) {
  return {
    policy: 'exclusive',
    expireInSeconds: config.queue.expireS,
    heartbeatSeconds: config.queue.heartbeatS,
    retryLimit: config.queue.retryLimit,
    retryDelay: config.queue.retryDelayS,
    deadLetter: REVIEW_DEAD_QUEUE,
    deleteAfterSeconds: 7 * 24 * 3600,
  } as const;
}

/** Create or update the queues. Run by `npm run db:migrate` only. */
export async function installQueues(boss: PgBoss, config: Config): Promise<void> {
  const ensure = async (name: string, options: Record<string, unknown>) => {
    if (await boss.getQueue(name)) {
      // Policy and dead-letter queue are fixed at creation; timings follow the current config.
      const { policy: _policy, deadLetter: _deadLetter, ...mutable } = options;
      await boss.updateQueue(name, mutable);
    } else {
      await boss.createQueue(name, options);
    }
  };
  await ensure(REVIEW_DEAD_QUEUE, { policy: 'standard', retryLimit: 3, retryDelay: 30 });
  await ensure(REVIEW_QUEUE, reviewQueueOptions(config));
  await ensure(MAINTENANCE_QUEUE, { policy: 'exclusive', retryLimit: 0, expireInSeconds: 300 });
  for (const name of RETIRED_QUEUES) if (await boss.getQueue(name)) await boss.deleteQueue(name);
}

/** Send inside the caller's transaction. Returns the job id, or null when one is already queued. */
export async function enqueueReview(boss: PgBoss, tx: Db, job: ReviewJob): Promise<string | null> {
  assertReviewJob(job);
  const db = { executeSql: (text: string, values?: unknown[]) => tx.query(text, values as unknown[]) };
  return boss.send(REVIEW_QUEUE, job, { singletonKey: job.requestId, db });
}

/** The claim a worker holds on one delivery of a review job (pg-boss `includeMetadata`). */
export interface ReviewAttempt { id: string; retryCount: number; retryLimit: number }

/**
 * Hand an interrupted job back without spending a retry (graceful worker shutdown). pg-boss counts a
 * retry on every re-claim of a started job, and its public API has no retry-preserving release, so in
 * one transaction: complete this delivery (fenced to the attempt, so a lost claim releases nothing)
 * and send the same job again under the same singletonKey with the retries this delivery still had.
 * Returns false when the claim was already lost (pg-boss then owns the retry).
 */
export async function releaseReview(boss: PgBoss, tx: Db, attempt: ReviewAttempt, job: ReviewJob): Promise<boolean> {
  assertReviewJob(job);
  const db = { executeSql: (text: string, values?: unknown[]) => tx.query(text, values as unknown[]) };
  // pg-boss 12 returns {jobs, requested, affected} here; its typings declare CommandResponse empty.
  const completed = await boss.complete(REVIEW_QUEUE, { id: attempt.id, retryCount: attempt.retryCount }, { released: true }, { db }) as { affected?: number };
  if (completed.affected !== 1) return false;
  const retryLimit = Math.max(0, attempt.retryLimit - attempt.retryCount);
  const id = await boss.send(REVIEW_QUEUE, job, { singletonKey: job.requestId, retryLimit, db });
  if (!id) throw new Error(`release of request ${job.requestId} was refused: another review job holds its singleton key`);
  return true;
}
