// POST /api/requests/:id/payment (INTAKE section 3 step 7): the tx must be FINAL and successful, signed
// by the request's account, a single `request_review(request_hash)` on our contract, and the contract
// must hold the request as Pending with enough deposit. Then, in one DB transaction: the payment row,
// awaiting_payment -> queued, and the pg-boss job.
import type { ChainPort, ChainRequest, PaymentTx } from '../../chain/port.ts';
import { isUniqueViolation, withTransaction, type Pool } from '../../db/pool.ts';
import { findPayment, insertPayment } from '../../db/repositories/payments.ts';
import { findRequest, statusAndPosition, transition, type RequestRow } from '../../db/repositories/requests.ts';
import { enqueueReview, type ReviewJob } from '../../queue/review-queue.ts';
import type { PgBoss } from '../../queue/boss.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, fail } from '../../shared/errors.ts';

export interface PaymentDeps { pool: Pool; clock: Clock; chain: ChainPort; boss: PgBoss }

export function jobFor(row: RequestRow): ReviewJob {
  return { requestId: row.id, requestHash: row.request_hash, repo: row.repo, commitSha: row.commit_sha, preset: row.preset, network: row.network };
}

/** Contract-side checks shared with the reconciler. */
export function checkChainRequest(row: RequestRow, chainRequest: ChainRequest | null): bigint {
  if (!chainRequest || chainRequest.status !== 'Pending') fail('PAYMENT_MISMATCH', 'The contract does not hold this request as pending');
  if (chainRequest.account !== row.account) fail('PAYMENT_SIGNER_MISMATCH', 'The request was paid by another account');
  if (chainRequest.depositYocto < BigInt(row.price_yocto)) fail('PAYMENT_MISMATCH', 'The deposit is below the quoted price');
  return chainRequest.depositYocto;
}

function checkTx(row: RequestRow, tx: PaymentTx | null, contractId: string): void {
  if (!tx) fail('PAYMENT_NOT_FOUND', 'The payment transaction was not found (it may not be final yet)');
  if (tx.signerId !== row.account) fail('PAYMENT_SIGNER_MISMATCH', 'The payment was signed by another account');
  if (!tx.succeeded) fail('PAYMENT_MISMATCH', 'The payment transaction did not succeed');
  if (tx.receiverId !== contractId || tx.requestHash !== row.request_hash) fail('PAYMENT_MISMATCH', 'The transaction does not pay for this request');
}

/** Payment row + queued + job, atomically. Shared with the reconciler. */
export async function markPaid(deps: PaymentDeps, row: RequestRow, payment: { txHash: string; amountYocto: bigint; actor: string; event: string }): Promise<void> {
  const now = deps.clock.now();
  await withTransaction(deps.pool, async (client) => {
    try {
      await insertPayment(client, { txHash: payment.txHash, requestId: row.id, amountYocto: payment.amountYocto.toString(), signer: row.account, now });
    } catch (error) {
      if (isUniqueViolation(error)) fail('TX_ALREADY_USED', 'This transaction was already used');
      throw error;
    }
    await transition(client, row.id, {
      to: 'queued', from: ['awaiting_payment'], patch: { queuedAt: now }, actor: payment.actor, event: payment.event,
      data: { txHash: payment.txHash }, now,
    });
    await enqueueReview(deps.boss, client, jobFor(row));
  });
}

export async function confirmPayment(deps: PaymentDeps, input: { requestId: string; account: string; txHash: string }) {
  const row = await findRequest(deps.pool, input.requestId);
  if (!row || row.account !== input.account) fail('REQUEST_NOT_FOUND', 'Request not found');
  const existing = await findPayment(deps.pool, input.txHash);
  if (existing && existing.request_id !== row.id) fail('TX_ALREADY_USED', 'This transaction was already used');
  if (!existing) {
    if (row.status !== 'awaiting_payment') fail('INVALID_TRANSITION', `Request is ${row.status}, not awaiting payment`);
    checkTx(row, await deps.chain.getPaymentTx(input.txHash, row.account), deps.chain.contractId);
    const deposit = checkChainRequest(row, await deps.chain.getRequest(row.request_hash));
    try {
      await markPaid(deps, row, { txHash: input.txHash, amountYocto: deposit, actor: 'api', event: 'payment_verified' });
    } catch (error) {
      // A concurrent confirm of the same tx for this request already won: answer like a replay.
      if (!(error instanceof AppError && error.code === 'TX_ALREADY_USED' && (await findPayment(deps.pool, input.txHash))?.request_id === row.id)) throw error;
    }
  }
  // Where the paid request is now: a replay after the worker started answers with that status, not `queued`.
  const current = await statusAndPosition(deps.pool, row.id);
  if (!current) fail('REQUEST_NOT_FOUND', 'Request not found');
  return current;
}
