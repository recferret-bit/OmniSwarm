// Public read model of a request (GET /api/requests/:id) and the signed-in account's list.
import type { Db } from '../../db/pool.ts';
import { timeline } from '../../db/repositories/audit.ts';
import { latestProgress, type ProgressRow } from '../../db/repositories/progress.ts';
import { findRequest, listByAccount, listThemes, queuePosition } from '../../db/repositories/requests.ts';
import type { z } from 'zod';
import type { progressDetail } from '../../http/schemas.ts';
import { iso } from '../../shared/clock.ts';
import { findLatestReportDir, readPipelineSummary } from './pipeline-view.ts';

type ProgressDetailDto = z.infer<typeof progressDetail>;
import { fail } from '../../shared/errors.ts';

export function progressDto(row: ProgressRow) {
  return {
    phase: row.phase,
    ...(row.reviewer ? { reviewer: row.reviewer } : {}),
    ...(row.pass ? { pass: row.pass } : {}),
    percent: Number(row.percent),
    // Stored by the worker from progress-detail.ts, which copies only the schema's fields.
    ...(row.detail ? { detail: row.detail as ProgressDetailDto } : {}),
  };
}

export async function viewRequest(db: Db, id: string, storage?: { reportsRoot: string; runsRoot: string }) {
  const row = await findRequest(db, id);
  if (!row) fail('REQUEST_NOT_FOUND', 'Request not found');
  const [progress, position, events, children] = await Promise.all([
    latestProgress(db, id),
    queuePosition(db, id),
    timeline(db, id),
    listThemes(db, id),
  ]);
  const nextRoundRequestIds = children
    .filter((c) => c.id !== id && c.debate_rounds !== null && c.debate_rounds !== undefined && c.debate_rounds >= 0)
    .map((c) => c.id);
  const dir = storage ? findLatestReportDir(storage.reportsRoot, storage.runsRoot, id) : null;
  const pipeline = readPipelineSummary(dir, row.pipeline_mode, nextRoundRequestIds);
  const showMode = (row.pipeline_mode && row.pipeline_mode !== 'full') || Boolean(pipeline);
  return {
    status: row.status,
    ...(progress ? { progress: progressDto(progress) } : {}),
    ...(position !== null ? { position } : {}),
    ...(row.report_url ? { reportUrl: row.report_url } : {}),
    ...(row.report_sha256 ? { reportSha256: row.report_sha256 } : {}),
    ...(row.incomplete !== null ? { incomplete: row.incomplete } : {}),
    ...(showMode ? { pipelineMode: row.pipeline_mode ?? 'full' } : {}),
    ...(pipeline ? { pipeline } : {}),
    ...(row.attest_tx ? { attestTx: row.attest_tx } : {}),
    ...(row.refund_tx ? { refundTx: row.refund_tx } : {}),
    ...(row.failure_cause ? { failureCause: row.failure_cause } : {}),
    timeline: events.map((event) => ({ event: event.event, at: iso(event.at) })),
    createdAt: iso(row.created_at),
  };
}

export async function listMine(db: Db, account: string) {
  const rows = await listByAccount(db, account);
  // A running request shows its phase and percent in the list; the full snapshot is on its own page.
  const progress = await Promise.all(rows.map((row) => (row.status === 'running' ? latestProgress(db, row.id) : Promise.resolve(null))));
  return {
    requests: rows.map((row, index) => {
      const latest = progress[index];
      return {
        requestId: row.id, repo: row.repo, status: row.status, createdAt: iso(row.created_at), ...(row.theme ? { theme: row.theme } : {}),
        ...(latest ? { progress: { phase: latest.phase, percent: Number(latest.percent) } } : {}),
      };
    }),
  };
}
