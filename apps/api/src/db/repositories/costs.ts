// `request_cost` (migration 004): the model cost of each finished request, summed from every attempt's
// usage files (W09-18). Operator bookkeeping only; nothing public reads it.
import type { Db } from '../pool.ts';

export async function recordRequestCost(db: Db, requestId: string, cost: { costUsd: number; reviewers: number }, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO request_cost (request_id, cost_usd, reviewers, recorded_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (request_id) DO UPDATE SET cost_usd = EXCLUDED.cost_usd, reviewers = EXCLUDED.reviewers, recorded_at = EXCLUDED.recorded_at`,
    [requestId, cost.costUsd, cost.reviewers, now]);
}
