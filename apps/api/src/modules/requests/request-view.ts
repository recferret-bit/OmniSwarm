// Public read model of a request (GET /api/requests/:id) and the signed-in account's list.
import type { Db } from '../../db/pool.ts';
import { timeline } from '../../db/repositories/audit.ts';
import { latestProgress, type ProgressRow } from '../../db/repositories/progress.ts';
import { findRequest, listByAccount, queuePosition } from '../../db/repositories/requests.ts';
import { iso } from '../../shared/clock.ts';
import { fail } from '../../shared/errors.ts';

export function progressDto(row: ProgressRow) {
  return {
    phase: row.phase,
    ...(row.reviewer ? { reviewer: row.reviewer } : {}),
    ...(row.pass ? { pass: row.pass } : {}),
    percent: Number(row.percent),
  };
}

export async function viewRequest(db: Db, id: string) {
  const row = await findRequest(db, id);
  if (!row) fail('REQUEST_NOT_FOUND', 'Request not found');
  const [progress, position, events] = await Promise.all([latestProgress(db, id), queuePosition(db, id), timeline(db, id)]);
  return {
    status: row.status,
    ...(progress ? { progress: progressDto(progress) } : {}),
    ...(position !== null ? { position } : {}),
    ...(row.report_url ? { reportUrl: row.report_url } : {}),
    ...(row.report_sha256 ? { reportSha256: row.report_sha256 } : {}),
    ...(row.incomplete !== null ? { incomplete: row.incomplete } : {}),
    ...(row.attest_tx ? { attestTx: row.attest_tx } : {}),
    ...(row.refund_tx ? { refundTx: row.refund_tx } : {}),
    timeline: events.map((event) => ({ event: event.event, at: iso(event.at) })),
    createdAt: iso(row.created_at),
  };
}

export async function listMine(db: Db, account: string) {
  const rows = await listByAccount(db, account);
  return { requests: rows.map((row) => ({ requestId: row.id, repo: row.repo, status: row.status, createdAt: iso(row.created_at) })) };
}
