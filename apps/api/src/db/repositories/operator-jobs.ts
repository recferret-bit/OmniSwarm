// Local operator history (`operator_job`). Not the paid `request` queue.
import type { Db } from '../pool.ts';

export type OperatorKind = 'path' | 'github';
export type OperatorStatus = 'queued' | 'running' | 'done' | 'failed';

export interface OperatorJobRow {
  id: string;
  kind: OperatorKind;
  source: string;
  ref: string | null;
  commit_sha: string | null;
  status: OperatorStatus;
  out_dir: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NewOperatorJob {
  id: string; kind: OperatorKind; source: string; ref: string | null; commitSha: string | null; outDir: string; now: Date;
}

export async function insertOperatorJob(db: Db, row: NewOperatorJob): Promise<void> {
  await db.query(
    `INSERT INTO operator_job (id, kind, source, ref, commit_sha, status, out_dir, error, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, NULL, $7, $7)`,
    [row.id, row.kind, row.source, row.ref, row.commitSha, row.outDir, row.now]);
}

export async function findOperatorJob(db: Db, id: string): Promise<OperatorJobRow | null> {
  const result = await db.query<OperatorJobRow>('SELECT * FROM operator_job WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function listOperatorJobs(db: Db): Promise<OperatorJobRow[]> {
  const result = await db.query<OperatorJobRow>('SELECT * FROM operator_job ORDER BY created_at DESC LIMIT 100');
  return result.rows;
}

export async function updateOperatorJob(db: Db, id: string, patch: { status: OperatorStatus; error: string | null; now: Date }): Promise<void> {
  await db.query('UPDATE operator_job SET status = $2, error = $3, updated_at = $4 WHERE id = $1', [id, patch.status, patch.error, patch.now]);
}
