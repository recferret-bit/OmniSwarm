// Chain side effects of a paid request: mark_running, attest and refund. Each runs under a per-request
// advisory lock and asks the contract first, so a retry after a crash (or an admin refund racing the
// worker) never sends a second attest or refund, and never overwrites an attestation.
import { ChainRejectedError } from '../../chain/errors.ts';
import { EMPTY_CODE_HASH, type ChainPort, type Severity } from '../../chain/port.ts';
import { withAdvisoryLock, type Pool } from '../../db/pool.ts';
import { findRequest, transition, type RequestRow } from '../../db/repositories/requests.ts';
import type { Clock } from '../../shared/clock.ts';
import { fail } from '../../shared/errors.ts';
import { ADMIN_REFUNDABLE, type Status } from '../requests/state.ts';

export interface SettlementDeps { pool: Pool; clock: Clock; chain: ChainPort }

/** The chain already holds a different report for this request. Never overwritten: alert a human. */
export class AttestationConflictError extends Error {
  override name = 'AttestationConflictError';
}

function locked<T>(deps: SettlementDeps, requestId: string, fn: () => Promise<T>): Promise<T> {
  return withAdvisoryLock(deps.pool, `request:${requestId}`, fn);
}

async function load(deps: SettlementDeps, requestId: string): Promise<RequestRow> {
  const row = await findRequest(deps.pool, requestId);
  if (!row) fail('REQUEST_NOT_FOUND', 'Request not found');
  return row;
}

/** Pending -> Running on chain. Returns false when the contract already refunded the request. */
export async function markRunningOnChain(deps: SettlementDeps, row: RequestRow): Promise<boolean> {
  const onChain = await deps.chain.getRequest(row.request_hash);
  if (!onChain) throw new ChainRejectedError('ERR_NOT_FOUND', 'the contract has no record of this paid request');
  if (onChain.status === 'Refunded') return false;
  if (onChain.status === 'Pending') await deps.chain.markRunning(row.request_hash);
  return true;
}

export async function refundRequest(deps: SettlementDeps, requestId: string, by: { actor: 'worker' | 'admin'; cause: string }) {
  return locked(deps, requestId, async () => {
    const row = await load(deps, requestId);
    if (row.status === 'refunded') return { refundTx: row.refund_tx };
    const allowed: readonly Status[] = by.actor === 'admin' ? ADMIN_REFUNDABLE : ['failed'];
    if (!allowed.includes(row.status)) fail('REFUND_NOT_ALLOWED', `A ${row.status} request cannot be refunded`);
    const onChain = await deps.chain.getRequest(row.request_hash);
    if (!onChain || onChain.status === 'Done') fail('REFUND_NOT_ALLOWED', 'The contract holds no refundable deposit for this request');
    // Refunded already: a previous attempt sent it and stopped before recording the tx.
    const refundTx = onChain.status === 'Refunded' ? null : await deps.chain.refund(row.request_hash);
    await transition(deps.pool, row.id, {
      to: 'refunded', patch: { refundTx }, actor: by.actor, event: by.actor === 'admin' ? 'admin_refund' : 'review_refunded',
      data: { cause: by.cause }, now: deps.clock.now(),
    });
    return { refundTx };
  });
}

export interface Attestation { reportUri: string; maxSeverity: Severity }

/** running -> publishing under the request lock, so an admin refund and a publication cannot both win. */
export async function beginPublishing(deps: SettlementDeps, requestId: string, report: Attestation & { reportSha256: string; incomplete: boolean }) {
  return locked(deps, requestId, () => transition(deps.pool, requestId, {
    to: 'publishing', from: ['running'], actor: 'worker', event: 'report_published', now: deps.clock.now(),
    patch: { reportSha256: report.reportSha256, reportUrl: report.reportUri, maxSeverity: report.maxSeverity, incomplete: report.incomplete },
    data: { reportSha256: report.reportSha256 },
  }));
}

/** running -> failed under the request lock; an infra failure is then refunded by the caller. */
export async function markFailed(deps: SettlementDeps, requestId: string, cause: string) {
  return locked(deps, requestId, () => transition(deps.pool, requestId, {
    to: 'failed', from: ['queued', 'running'], patch: { failureCause: cause }, actor: 'worker', event: 'review_failed',
    data: { cause }, now: deps.clock.now(),
  }));
}

/** publishing -> done. The report hash is the one stored when the report was published. */
export async function attestRequest(deps: SettlementDeps, requestId: string, attestation: Attestation): Promise<string | null> {
  return locked(deps, requestId, async () => {
    const row = await load(deps, requestId);
    if (row.status === 'done') return row.attest_tx;
    if (row.status !== 'publishing' || !row.report_sha256) fail('INVALID_TRANSITION', `Request is ${row.status}, not publishing`);
    const onChain = await deps.chain.getRequest(row.request_hash);
    let attestTx: string | null = null;
    if (onChain?.status === 'Done') {
      const existing = await deps.chain.getAttestation(row.request_hash);
      if (existing?.reportSha256 !== row.report_sha256) {
        throw new AttestationConflictError(`chain attests ${existing?.reportSha256 ?? 'nothing'}, published report is ${row.report_sha256}`);
      }
    } else if (onChain?.status === 'Pending' || onChain?.status === 'Running') {
      // The contract takes `deployed` and `code_hash` together or not at all; an account without code is not bound.
      const account = row.deployed ? await deps.chain.viewAccount(row.deployed) : null;
      const codeHash = account && account.codeHash !== EMPTY_CODE_HASH ? account.codeHash : null;
      attestTx = await deps.chain.attest({
        requestHash: row.request_hash, repo: row.repo, commit: row.commit_sha, reportSha256: row.report_sha256,
        reportUri: attestation.reportUri, deployed: codeHash ? row.deployed : null, codeHash, maxSeverity: attestation.maxSeverity,
      });
    } else {
      throw new ChainRejectedError('ERR_BAD_STATUS', `the contract holds this request as ${onChain?.status ?? 'unknown'}`);
    }
    await transition(deps.pool, row.id, {
      to: 'done', from: ['publishing'], patch: { attestTx }, actor: 'worker', event: 'review_attested',
      data: { reportSha256: row.report_sha256 }, now: deps.clock.now(),
    });
    return attestTx;
  });
}
