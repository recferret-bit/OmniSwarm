// The `request` aggregate. Status changes are one statement: the guarded UPDATE, its audit_log row
// and a NOTIFY on `request_events` (delivered to SSE listeners on commit).
import { AppError } from '../../shared/errors.ts';
import { sourcesOf, type Status } from '../../modules/requests/state.ts';
import type { Db } from '../pool.ts';

export const EVENTS_CHANNEL = 'request_events';

export interface RequestRow {
  id: string;
  account: string;
  repo: string;
  commit_sha: string;
  network: 'testnet' | 'mainnet';
  preset: string;
  deployed: string | null;
  request_hash: string;
  price_yocto: string;
  status: Status;
  attempts: number;
  failure_cause: string | null;
  report_sha256: string | null;
  report_url: string | null;
  max_severity: string | null;
  incomplete: boolean | null;
  attest_tx: string | null;
  refund_tx: string | null;
  queued_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface NewRequest {
  id: string; account: string; repo: string; commitSha: string; network: string; preset: string;
  deployed: string | null; requestHash: string; priceYocto: string; now: Date;
}

const PATCHABLE = {
  attempts: 'attempts', failureCause: 'failure_cause', reportSha256: 'report_sha256', reportUrl: 'report_url',
  maxSeverity: 'max_severity', incomplete: 'incomplete', attestTx: 'attest_tx', refundTx: 'refund_tx', queuedAt: 'queued_at',
} as const;
export type RequestPatch = Partial<Record<keyof typeof PATCHABLE, string | number | boolean | Date | null>>;

export interface Transition {
  to: Status;
  /** Narrows the legal sources further (for example only `awaiting_payment` for a payment). */
  from?: readonly Status[];
  patch?: RequestPatch;
  actor: string;
  event: string;
  data?: Record<string, unknown>;
  now: Date;
}

export async function insertRequest(db: Db, row: NewRequest): Promise<void> {
  await db.query(
    `WITH created AS (
       INSERT INTO request (id, account, repo, commit_sha, network, preset, deployed, request_hash, price_yocto, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'awaiting_payment',$10,$10) RETURNING id)
     INSERT INTO audit_log (ts, actor, request_id, event, data) SELECT $10, 'api', id, 'request_created', $11 FROM created`,
    [row.id, row.account, row.repo, row.commitSha, row.network, row.preset, row.deployed, row.requestHash, row.priceYocto, row.now,
      JSON.stringify({ repo: row.repo, commit: row.commitSha })]);
}

export async function findRequest(db: Db, id: string, lock = false): Promise<RequestRow | null> {
  const result = await db.query<RequestRow>(`SELECT * FROM request WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return result.rows[0] ?? null;
}

export async function transition(db: Db, id: string, change: Transition): Promise<RequestRow> {
  const allowed = sourcesOf(change.to).filter((status) => !change.from || change.from.includes(status));
  const values: unknown[] = [id, change.to, change.now, allowed, change.actor, change.event, JSON.stringify(change.data ?? {})];
  const sets = Object.entries(change.patch ?? {}).map(([key, value]) => {
    values.push(value);
    return `${PATCHABLE[key as keyof typeof PATCHABLE]} = $${values.length}`;
  });
  const result = await db.query<RequestRow>(
    `WITH moved AS (
       UPDATE request SET status = $2, updated_at = $3${sets.map((set) => `, ${set}`).join('')}
       WHERE id = $1 AND status = ANY($4::text[]) RETURNING *),
     logged AS (
       INSERT INTO audit_log (ts, actor, request_id, event, data)
       SELECT $3, $5, id, $6, $7::jsonb || jsonb_build_object('status', status) FROM moved)
     SELECT moved.* FROM moved, LATERAL (SELECT pg_notify('${EVENTS_CHANNEL}', moved.id::text)) AS notified`,
    values);
  const row = result.rows[0];
  if (row) return row;
  const current = await findRequest(db, id);
  if (!current) throw new AppError('REQUEST_NOT_FOUND', 'Request not found');
  throw new AppError('INVALID_TRANSITION', `Request is ${current.status}; it cannot become ${change.to}`);
}

export async function listByAccount(db: Db, account: string): Promise<RequestRow[]> {
  const result = await db.query<RequestRow>('SELECT * FROM request WHERE account = $1 ORDER BY created_at DESC LIMIT 100', [account]);
  return result.rows;
}

/** 1-based rank among queued requests by the time payment was confirmed; null when not queued. */
export async function queuePosition(db: Db, id: string): Promise<number | null> {
  const result = await db.query<{ position: number }>(
    `SELECT 1 + (SELECT count(*)::int FROM request q WHERE q.status = 'queued' AND (q.queued_at, q.id) < (r.queued_at, r.id)) AS position
     FROM request r WHERE r.id = $1 AND r.status = 'queued'`, [id]);
  return result.rows[0]?.position ?? null;
}

/** Requests that hold a queue slot: paid and not yet finished. */
export async function queueDepth(db: Db): Promise<number> {
  const result = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM request WHERE status IN ('queued', 'running', 'publishing')`);
  return result.rows[0]?.n ?? 0;
}

export async function accountUsage(db: Db, account: string, since: Date): Promise<{ active: number; recent: number }> {
  const result = await db.query<{ active: number; recent: number }>(
    `SELECT count(*) FILTER (WHERE status IN ('queued', 'running', 'publishing'))::int AS active,
            count(*) FILTER (WHERE created_at >= $2)::int AS recent
     FROM request WHERE account = $1`, [account, since]);
  return result.rows[0] ?? { active: 0, recent: 0 };
}

export async function awaitingPayment(db: Db, limit = 200): Promise<RequestRow[]> {
  const result = await db.query<RequestRow>(
    `SELECT * FROM request WHERE status = 'awaiting_payment' ORDER BY created_at LIMIT $1`, [limit]);
  return result.rows;
}
