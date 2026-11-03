// `request_cost` (migration 004) and the public ledger read (W09-18). The ledger joins paid requests
// with their payment and cost; it never selects an account.
import type { Status } from '../../modules/requests/state.ts';
import type { Db } from '../pool.ts';

export async function recordRequestCost(db: Db, requestId: string, cost: { costUsd: number; reviewers: number }, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO request_cost (request_id, cost_usd, reviewers, recorded_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (request_id) DO UPDATE SET cost_usd = EXCLUDED.cost_usd, reviewers = EXCLUDED.reviewers, recorded_at = EXCLUDED.recorded_at`,
    [requestId, cost.costUsd, cost.reviewers, now]);
}

export interface LedgerRow {
  id: string; repo: string; status: Status; price_yocto: string; paid_yocto: string; cost_usd: number; reviewers: number; refund_tx: string | null;
}

export interface LedgerTotals { requests: number; sales_yocto: string; refunded_yocto: string; cost_usd: number }

const PAID = `FROM request r JOIN payment p ON p.request_id = r.id LEFT JOIN request_cost c ON c.request_id = r.id`;

export async function ledgerRows(db: Db, limit: number): Promise<LedgerRow[]> {
  const result = await db.query<LedgerRow>(
    `SELECT r.id, r.repo, r.status, r.price_yocto::text AS price_yocto, p.amount_yocto::text AS paid_yocto,
            coalesce(c.cost_usd, 0)::float8 AS cost_usd, coalesce(c.reviewers, 0) AS reviewers, r.refund_tx
     ${PAID} ORDER BY p.verified_at DESC, r.id LIMIT $1`, [limit]);
  return result.rows;
}

export async function ledgerTotals(db: Db): Promise<LedgerTotals> {
  const result = await db.query<LedgerTotals>(
    `SELECT count(*)::int AS requests,
            coalesce(sum(p.amount_yocto) FILTER (WHERE r.status <> 'refunded'), 0)::text AS sales_yocto,
            coalesce(sum(p.amount_yocto) FILTER (WHERE r.status = 'refunded'), 0)::text AS refunded_yocto,
            coalesce(sum(c.cost_usd), 0)::float8 AS cost_usd
     ${PAID}`);
  return result.rows[0] ?? { requests: 0, sales_yocto: '0', refunded_yocto: '0', cost_usd: 0 };
}
