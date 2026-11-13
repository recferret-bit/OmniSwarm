// Creating a request: the row is inserted as `queued` and its pg-boss job sent in one transaction, so a
// request is never queued without a job or the other way round. Reviews are free: there is no payment step.
import { withTransaction, type Db, type Pool } from '../../db/pool.ts';
import { accountUsage, insertRequest, type NewRequest, type RequestRow } from '../../db/repositories/requests.ts';
import type { PgBoss } from '../../queue/boss.ts';
import { enqueueReview, type ReviewJob } from '../../queue/review-queue.ts';
import { fail } from '../../shared/errors.ts';
import type { Config } from '../../config/load.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export function jobFor(row: Pick<RequestRow, 'id' | 'repo' | 'commit_sha' | 'preset'>): ReviewJob {
  return { requestId: row.id, repo: row.repo, commitSha: row.commit_sha, preset: row.preset };
}

/** One review in progress per account and the daily cap. */
export async function assertAccountCapacity(db: Db, config: Config, account: string, now: Date): Promise<void> {
  const usage = await accountUsage(db, account, new Date(now.getTime() - DAY_MS));
  if (usage.active > 0) fail('RATE_LIMITED', 'This account already has a review in progress');
  if (usage.recent >= config.intake.requestsPerDay) fail('RATE_LIMITED', 'Daily request limit reached for this account');
}

export async function queueRequest(deps: { pool: Pool; boss: PgBoss }, row: NewRequest): Promise<void> {
  await withTransaction(deps.pool, async (client) => {
    await insertRequest(client, row);
    await enqueueReview(deps.boss, client, jobFor({ id: row.id, repo: row.repo, commit_sha: row.commitSha, preset: row.preset }));
  });
}
