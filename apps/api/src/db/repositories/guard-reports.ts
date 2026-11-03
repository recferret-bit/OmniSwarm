// The `guard_report` aggregate (migration 003). Status changes are guarded UPDATEs, like requests.
import type { Db } from '../pool.ts';

export const GUARD_REPORT_STATUSES = ['pending', 'approved', 'reported', 'rejected'] as const;
export type GuardReportStatus = (typeof GUARD_REPORT_STATUSES)[number];

export interface GuardReportRow {
  id: string;
  account: string;
  reporter: string;
  evidence_url: string;
  reason: string;
  status: GuardReportStatus;
  report_tx: string | null;
  created_at: Date;
  decided_at: Date | null;
  reported_at: Date | null;
}

export interface NewGuardReport { id: string; account: string; reporter: string; evidenceUrl: string; reason: string; now: Date }

/** Insert a pending report, or return the reporter's open report on the same account. */
export async function insertGuardReport(db: Db, report: NewGuardReport): Promise<{ row: GuardReportRow; created: boolean }> {
  const inserted = await db.query<GuardReportRow>(
    `INSERT INTO guard_report (id, account, reporter, evidence_url, reason, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     ON CONFLICT (reporter, account) WHERE status = 'pending' DO NOTHING RETURNING *`,
    [report.id, report.account, report.reporter, report.evidenceUrl, report.reason, report.now]);
  if (inserted.rows[0]) return { row: inserted.rows[0], created: true };
  const open = await db.query<GuardReportRow>(
    `SELECT * FROM guard_report WHERE reporter = $1 AND account = $2 AND status = 'pending'`, [report.reporter, report.account]);
  if (!open.rows[0]) throw new Error('guard report neither inserted nor open');
  return { row: open.rows[0], created: false };
}

export async function findGuardReport(db: Db, id: string, lock = false): Promise<GuardReportRow | null> {
  const result = await db.query<GuardReportRow>(`SELECT * FROM guard_report WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return result.rows[0] ?? null;
}

export async function listGuardReports(db: Db, status: GuardReportStatus | null, limit = 200): Promise<GuardReportRow[]> {
  const result = await db.query<GuardReportRow>(
    `SELECT * FROM guard_report WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2`, [status, limit]);
  return result.rows;
}

/** pending -> approved | rejected. Returns null when the report is not pending. */
export async function decideGuardReport(db: Db, id: string, to: 'approved' | 'rejected', now: Date): Promise<GuardReportRow | null> {
  const result = await db.query<GuardReportRow>(
    `UPDATE guard_report SET status = $2, decided_at = $3 WHERE id = $1 AND status = 'pending' RETURNING *`, [id, to, now]);
  return result.rows[0] ?? null;
}

/** approved -> reported, with the tx hash when this worker sent it (null when the chain already had it). */
export async function markGuardReported(db: Db, id: string, reportTx: string | null, now: Date): Promise<GuardReportRow | null> {
  const result = await db.query<GuardReportRow>(
    `UPDATE guard_report SET status = 'reported', report_tx = $2, reported_at = $3 WHERE id = $1 AND status = 'approved' RETURNING *`,
    [id, reportTx, now]);
  return result.rows[0] ?? null;
}
