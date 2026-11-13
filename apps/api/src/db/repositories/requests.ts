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
  preset: string;
  status: Status;
  attempts: number;
  failure_cause: string | null;
  report_sha256: string | null;
  report_url: string | null;
  max_severity: string | null;
  scope: 'full' | 'web2' | 'web3';
  theme: string | null;
  parent_id: string | null;
  slice_path: string | null;
  models: string[] | null;
  pipeline_mode?: 'full' | 'step-by-step' | 'stage-1';
  debate_rounds?: number | null;
  incomplete: boolean | null;
  queued_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface NewRequest {
  id: string; account: string; repo: string; commitSha: string; preset: string; now: Date;
  scope?: 'full' | 'web2' | 'web3';
  models?: string[] | null;
  pipelineMode?: 'full' | 'step-by-step' | 'stage-1';
  parentId?: string | null;
  debateRounds?: number | null;
  theme?: string | null;
}

const PATCHABLE = {
  attempts: 'attempts', failureCause: 'failure_cause', reportSha256: 'report_sha256', reportUrl: 'report_url',
  maxSeverity: 'max_severity', incomplete: 'incomplete', queuedAt: 'queued_at',
} as const;
export type RequestPatch = Partial<Record<keyof typeof PATCHABLE, string | number | boolean | Date | null>>;

export interface Transition {
  to: Status;
  /** Narrows the legal sources further. */
  from?: readonly Status[];
  patch?: RequestPatch;
  actor: string;
  event: string;
  data?: Record<string, unknown>;
  now: Date;
}

/** A new request is `queued` at once: reviews are free, so there is nothing to wait for. The caller enqueues the job in the same transaction. */
export async function insertRequest(db: Db, row: NewRequest): Promise<void> {
  await db.query(
    `WITH created AS (
       INSERT INTO request (id, account, repo, commit_sha, preset, status, queued_at, created_at, updated_at, scope, models, pipeline_mode, parent_id, debate_rounds, theme)
       VALUES ($1,$2,$3,$4,$5,'queued',$6,$6,$6,$8,$9,$10,$11,$12,$13) RETURNING id)
     INSERT INTO audit_log (ts, actor, request_id, event, data) SELECT $6, 'api', id, 'request_created', $7 FROM created`,
    [row.id, row.account, row.repo, row.commitSha, row.preset, row.now,
      JSON.stringify({ repo: row.repo, commit: row.commitSha, ...(row.pipelineMode && row.pipelineMode !== 'full' ? { pipelineMode: row.pipelineMode } : {}), ...(row.debateRounds !== null && row.debateRounds !== undefined ? { debateRounds: row.debateRounds } : {}) }),
      row.scope ?? 'full', row.models ?? null, row.pipelineMode ?? 'full', row.parentId ?? null, row.debateRounds ?? null, row.theme ?? null]);
}

export async function insertThemeRequest(db: Db, row: {
  id: string; parent: RequestRow; theme: string; slicePath: string; now: Date;
}): Promise<void> {
  await db.query(
    `INSERT INTO request (id, account, repo, commit_sha, preset, status, created_at, updated_at, queued_at, scope, theme, parent_id, slice_path, models, pipeline_mode)
     VALUES ($1,$2,$3,$4,$5,'queued',$6,$6,$6,$7,$8,$9,$10,$11,$12)`,
    [row.id, row.parent.account, row.parent.repo, row.parent.commit_sha, row.parent.preset,
      row.now, row.parent.scope, row.theme, row.parent.id, row.slicePath, row.parent.models, row.parent.pipeline_mode ?? 'full']);
}

export async function listRecent(db: Db, limit = 200): Promise<RequestRow[]> {
  const result = await db.query<RequestRow>(
    'SELECT * FROM request ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows;
}

export async function listThemes(db: Db, parentId: string): Promise<RequestRow[]> {
  const result = await db.query<RequestRow>('SELECT * FROM request WHERE parent_id = $1 ORDER BY created_at', [parentId]);
  return result.rows;
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

/** 1-based rank among queued requests by the time they were queued; null when not queued. */
export async function queuePosition(db: Db, id: string): Promise<number | null> {
  return (await statusAndPosition(db, id))?.position ?? null;
}

/** The status and, while queued, the queue rank, read in one statement so the two agree. */
export async function statusAndPosition(db: Db, id: string): Promise<{ status: Status; position: number | null } | null> {
  const result = await db.query<{ status: Status; position: number | null }>(
    `SELECT r.status, CASE WHEN r.status = 'queued' THEN 1 + (SELECT count(*)::int FROM request q
       WHERE q.status = 'queued' AND (q.queued_at, q.id) < (r.queued_at, r.id)) END AS position
     FROM request r WHERE r.id = $1`, [id]);
  return result.rows[0] ?? null;
}

/** Requests that hold a queue slot: queued, running or publishing. */
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
