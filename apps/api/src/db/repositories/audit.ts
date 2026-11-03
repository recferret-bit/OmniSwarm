// audit_log rows carry codes and ids only: never a signature, a key or a message body.
import type { Db } from '../pool.ts';

export async function audit(db: Db, entry: { actor: string; requestId: string | null; event: string; data?: Record<string, unknown>; now: Date }): Promise<void> {
  await db.query('INSERT INTO audit_log (ts, actor, request_id, event, data) VALUES ($1, $2, $3, $4, $5)',
    [entry.now, entry.actor, entry.requestId, entry.event, JSON.stringify(entry.data ?? {})]);
}

const PUBLIC_EVENTS = ['request_created', 'payment_verified', 'reconciled', 'review_started', 'report_published', 'review_attested',
  'review_failed', 'review_refunded', 'admin_refund', 'expired'];

/** The public, redacted timeline of one request: event names and times only. */
export async function timeline(db: Db, requestId: string): Promise<Array<{ event: string; at: Date }>> {
  const result = await db.query<{ event: string; ts: Date }>(
    'SELECT event, ts FROM audit_log WHERE request_id = $1 AND event = ANY($2::text[]) ORDER BY id LIMIT 50', [requestId, PUBLIC_EVENTS]);
  return result.rows.map((row) => ({ event: row.event, at: row.ts }));
}
