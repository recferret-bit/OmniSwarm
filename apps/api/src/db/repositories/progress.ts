import type { Db } from '../pool.ts';
import { EVENTS_CHANNEL } from './requests.ts';

export interface Progress { phase: string; reviewer?: string; pass?: number; percent: number; message?: string }
export interface ProgressRow { id: string; ts: Date; phase: string; reviewer: string | null; pass: number | null; percent: number; message: string | null }

/** Append one row and NOTIFY listeners in the same statement. */
export async function appendProgress(db: Db, requestId: string, progress: Progress, now: Date): Promise<void> {
  await db.query(
    `WITH added AS (
       INSERT INTO request_progress (request_id, ts, phase, reviewer, pass, percent, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING request_id)
     SELECT pg_notify('${EVENTS_CHANNEL}', request_id::text) FROM added`,
    [requestId, now, progress.phase, progress.reviewer ?? null, progress.pass ?? null, progress.percent, progress.message ?? null]);
}

export async function progressSince(db: Db, requestId: string, afterId: string): Promise<ProgressRow[]> {
  const result = await db.query<ProgressRow>(
    'SELECT * FROM request_progress WHERE request_id = $1 AND id > $2 ORDER BY id LIMIT 500', [requestId, afterId]);
  return result.rows;
}

export async function latestProgress(db: Db, requestId: string): Promise<ProgressRow | null> {
  const result = await db.query<ProgressRow>('SELECT * FROM request_progress WHERE request_id = $1 ORDER BY id DESC LIMIT 1', [requestId]);
  return result.rows[0] ?? null;
}
