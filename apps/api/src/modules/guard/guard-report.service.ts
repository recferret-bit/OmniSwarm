// Guard reports (INTAKE section 4, W13): a signed-in account files a report, the owner reviews it on
// the loopback admin listener, and an approved report becomes `report_address` on chain. The API never
// signs: approval records the decision and enqueues a `guard-report` job in one transaction, and a
// worker (the only operator-key holder) sends it, asking the contract first so a retry never re-sends.
import crypto from 'node:crypto';
import type { ChainPort } from '../../chain/port.ts';
import { withAdvisoryLock, withTransaction, type Pool } from '../../db/pool.ts';
import { audit } from '../../db/repositories/audit.ts';
import {
  decideGuardReport, findGuardReport, insertGuardReport, listGuardReports, markGuardReported,
  type GuardReportRow, type GuardReportStatus,
} from '../../db/repositories/guard-reports.ts';
import type { PgBoss } from '../../queue/boss.ts';
import { enqueueGuardReport } from '../../queue/review-queue.ts';
import { iso, type Clock } from '../../shared/clock.ts';
import { fail } from '../../shared/errors.ts';

export interface GuardReportDeps { pool: Pool; clock: Clock; boss: PgBoss }

export interface GuardReportInput { account: string; evidenceUrl: string; reason: string }

export async function submitGuardReport(deps: Pick<GuardReportDeps, 'pool' | 'clock'>, reporter: string, input: GuardReportInput) {
  const now = deps.clock.now();
  return withTransaction(deps.pool, async (client) => {
    const { row, created } = await insertGuardReport(client, { id: crypto.randomUUID(), reporter, now, ...input });
    if (created) await audit(client, { actor: 'api', requestId: null, event: 'guard_report_filed', data: { reportId: row.id, account: row.account }, now });
    return { queued: true as const, reportId: row.id };
  });
}

export function guardReportDto(row: GuardReportRow) {
  return {
    reportId: row.id, account: row.account, reporter: row.reporter, evidenceUrl: row.evidence_url, reason: row.reason,
    status: row.status, reportTx: row.report_tx, createdAt: iso(row.created_at),
  };
}

export async function listReports(deps: Pick<GuardReportDeps, 'pool'>, status: GuardReportStatus | null) {
  return { reports: (await listGuardReports(deps.pool, status)).map(guardReportDto) };
}

/** pending -> approved + a `guard-report` job, or pending -> rejected. A repeated decision answers with the state. */
export async function decideReport(deps: GuardReportDeps, reportId: string, decision: 'approved' | 'rejected') {
  return withTransaction(deps.pool, async (client) => {
    const row = await findGuardReport(client, reportId, true);
    if (!row) fail('NOT_FOUND', 'Guard report not found');
    if (row.status === decision || (decision === 'approved' && row.status === 'reported')) return { status: row.status, reportTx: row.report_tx };
    if (row.status !== 'pending') fail('INVALID_TRANSITION', `The report is ${row.status}; it cannot be ${decision}`);
    const now = deps.clock.now();
    await decideGuardReport(client, reportId, decision, now);
    await audit(client, { actor: 'admin', requestId: null, event: `guard_report_${decision}`, data: { reportId, account: row.account }, now });
    if (decision === 'approved') await enqueueGuardReport(deps.boss, client, { reportId });
    return { status: decision, reportTx: null };
  });
}

/** Worker: send `report_address` for an approved report unless the contract already lists the account. */
export async function sendGuardReport(deps: { pool: Pool; clock: Clock; chain: ChainPort }, reportId: string) {
  const row = await findGuardReport(deps.pool, reportId);
  if (!row) fail('NOT_FOUND', 'Guard report not found');
  return withAdvisoryLock(deps.pool, `guard-report:${row.account}`, async () => {
    const current = await findGuardReport(deps.pool, reportId);
    if (current?.status !== 'approved') return { skipped: current?.status ?? 'missing' };
    const reportTx = (await deps.chain.isReported(current.account))
      ? null
      : await deps.chain.reportAddress({ accountId: current.account, evidenceUri: current.evidence_url, reason: current.reason });
    const now = deps.clock.now();
    await withTransaction(deps.pool, async (client) => {
      await markGuardReported(client, reportId, reportTx, now);
      await audit(client, { actor: 'worker', requestId: null, event: 'address_reported', data: { reportId, account: current.account, reportTx }, now });
    });
    return { reported: current.account, reportTx };
  });
}
