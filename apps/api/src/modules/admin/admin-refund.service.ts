// Admin refund (W09-17) without a key in the API: record the intent and enqueue a `refund` job in one
// transaction. A worker signs and sends the refund (settlement.service refundRequest, idempotent by
// request_hash). Only queued, running or failed requests can be refunded.
import { withTransaction, type Pool } from '../../db/pool.ts';
import { audit } from '../../db/repositories/audit.ts';
import { findRequest } from '../../db/repositories/requests.ts';
import { enqueueRefund } from '../../queue/review-queue.ts';
import type { PgBoss } from '../../queue/boss.ts';
import type { Clock } from '../../shared/clock.ts';
import { fail } from '../../shared/errors.ts';
import { ADMIN_REFUNDABLE } from '../requests/state.ts';

export interface AdminRefundDeps { pool: Pool; clock: Clock; boss: PgBoss }

export type AdminRefund = { status: 'refunded'; refundTx: string | null } | { status: 'refund_queued' };

export async function requestRefund(deps: AdminRefundDeps, requestId: string): Promise<AdminRefund> {
  return withTransaction(deps.pool, async (client) => {
    const row = await findRequest(client, requestId, true);
    if (!row) fail('REQUEST_NOT_FOUND', 'Request not found');
    if (row.status === 'refunded') return { status: 'refunded', refundTx: row.refund_tx };
    if (!ADMIN_REFUNDABLE.includes(row.status)) fail('REFUND_NOT_ALLOWED', `A ${row.status} request cannot be refunded`);
    await audit(client, { actor: 'admin', requestId, event: 'admin_refund_requested', data: { status: row.status }, now: deps.clock.now() });
    await enqueueRefund(deps.boss, client, { requestId, requestHash: row.request_hash });
    return { status: 'refund_queued' };
  });
}
