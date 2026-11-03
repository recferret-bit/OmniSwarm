// The `review` queue (INTAKE section 3 step 7, W09-02). A job is sent inside the caller's payment
// transaction through pg-boss's `db` option, so "paid" and "enqueued" commit or roll back together.
// Policy `exclusive` + singletonKey=requestHash: at most one queued-or-active job per request.
import { validate } from '@omniswarm/schemas';
import type { Config } from '../config/load.ts';
import type { Db } from '../db/pool.ts';
import type { PgBoss } from './boss.ts';

export const REVIEW_QUEUE = 'review';
/** Jobs that exhausted their retries (a worker died twice): settled as an infra failure. */
export const REVIEW_DEAD_QUEUE = 'review-dead';
export const MAINTENANCE_QUEUE = 'maintenance';
/** Admin refunds: recorded by the API, signed and sent by a worker (the only holder of the operator key). */
export const REFUND_QUEUE = 'refund';

export interface ReviewJob {
  requestId: string;
  requestHash: string;
  repo: string;
  commitSha: string;
  preset: string;
  network: 'testnet' | 'mainnet';
}

export class JobContractError extends Error {
  override name = 'JobContractError';
}

/** packages/schemas/job.schema.json#/$defs/input, checked on send and again on fetch. */
export function assertReviewJob(data: unknown): ReviewJob {
  const result = validate('job#input', data);
  if (!result.ok) throw new JobContractError(`job payload rejected: ${result.errors.join('; ')}`);
  return data as ReviewJob;
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
  await ensure(REFUND_QUEUE, { policy: 'exclusive', retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 });
  await ensure(MAINTENANCE_QUEUE, { policy: 'exclusive', retryLimit: 0, expireInSeconds: 300 });
}

/** Send inside the caller's transaction. Returns the job id, or null when one is already queued. */
export async function enqueueReview(boss: PgBoss, tx: Db, job: ReviewJob): Promise<string | null> {
  assertReviewJob(job);
  const db = { executeSql: (text: string, values?: unknown[]) => tx.query(text, values as unknown[]) };
  return boss.send(REVIEW_QUEUE, job, { singletonKey: job.requestHash, db });
}

export interface RefundJob { requestId: string; requestHash: string }

export function assertRefundJob(data: unknown): RefundJob {
  const job = data as Partial<RefundJob> | null;
  if (!job || !/^[0-9a-f-]{36}$/.test(String(job.requestId)) || !/^[0-9a-f]{64}$/.test(String(job.requestHash))) {
    throw new JobContractError('refund job payload rejected');
  }
  return { requestId: String(job.requestId), requestHash: String(job.requestHash) };
}

/** One pending refund job per request, sent inside the caller's transaction. */
export async function enqueueRefund(boss: PgBoss, tx: Db, job: RefundJob): Promise<string | null> {
  const db = { executeSql: (text: string, values?: unknown[]) => tx.query(text, values as unknown[]) };
  return boss.send(REFUND_QUEUE, assertRefundJob(job), { singletonKey: job.requestHash, db });
}
