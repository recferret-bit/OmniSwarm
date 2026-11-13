// The request's last status changes. Each is one guarded transition (requests.ts), so a re-delivered job
// that repeats a step finds the request already moved and does nothing twice.
import type { Pool } from '../db/pool.ts';
import { findRequest, transition, type RequestRow } from '../db/repositories/requests.ts';
import type { Clock } from '../shared/clock.ts';
import { fail } from '../shared/errors.ts';
import type { Severity } from './report.ts';

export interface SettleDeps { pool: Pool; clock: Clock }

export interface PublishedReport { reportSha256: string; reportUrl: string; maxSeverity: Severity; incomplete: boolean }

/** running -> publishing, recording what was published. */
export function beginPublishing(deps: SettleDeps, requestId: string, report: PublishedReport): Promise<RequestRow> {
  return transition(deps.pool, requestId, {
    to: 'publishing', from: ['running'], actor: 'worker', event: 'report_published', now: deps.clock.now(),
    patch: { reportSha256: report.reportSha256, reportUrl: report.reportUrl, maxSeverity: report.maxSeverity, incomplete: report.incomplete },
    data: { reportSha256: report.reportSha256 },
  });
}

/** queued or running -> failed. */
export function markFailed(deps: SettleDeps, requestId: string, cause: string): Promise<RequestRow> {
  return transition(deps.pool, requestId, {
    to: 'failed', from: ['queued', 'running'], patch: { failureCause: cause }, actor: 'worker', event: 'review_failed',
    data: { cause }, now: deps.clock.now(),
  });
}

/** publishing -> done. Already done is returned as is. */
export async function finishRequest(deps: SettleDeps, requestId: string): Promise<RequestRow> {
  const row = await findRequest(deps.pool, requestId);
  if (!row) fail('REQUEST_NOT_FOUND', 'Request not found');
  if (row.status === 'done') return row;
  if (row.status !== 'publishing' || !row.report_sha256) fail('INVALID_TRANSITION', `Request is ${row.status}, not publishing`);
  return transition(deps.pool, requestId, {
    to: 'done', from: ['publishing'], actor: 'worker', event: 'review_done', data: { reportSha256: row.report_sha256 }, now: deps.clock.now(),
  });
}
