// The user's side of the mock chain: what a wallet would put on chain (keys, a payable
// `request_review`). Used by the dev scripts (sign-request, mock-pay) and tests only.
import { withTransaction, type Db, type Pool } from '../../db/pool.ts';
import { ChainRejectedError } from '../errors.ts';
import { EMPTY_CODE_HASH, type KeyPermission } from '../port.ts';
import { mockTxHash } from './mock-chain.ts';
import { REQUEST_STORAGE_YOCTO, requireHash, yocto } from './mock-validate.ts';

function poolOf(db: Db): Pool {
  const pool = db as Pool;
  if (typeof pool.connect !== 'function') throw new Error('payRequestReview needs a pool');
  return pool;
}

export async function registerKey(db: Db, account: string, publicKey: string, permission: KeyPermission): Promise<void> {
  await db.query(
    `INSERT INTO mock_chain_key (account, public_key, permission) VALUES ($1, $2, $3)
     ON CONFLICT (account, public_key) DO UPDATE SET permission = EXCLUDED.permission`,
    [account, publicKey, permission]);
}

export async function setCodeHash(db: Db, account: string, codeHash: string): Promise<void> {
  await db.query(
    `INSERT INTO mock_chain_account (account, code_hash) VALUES ($1, $2)
     ON CONFLICT (account) DO UPDATE SET code_hash = EXCLUDED.code_hash`, [account, codeHash]);
}

/**
 * Simulate `request_review(request_hash)` with an attached deposit, signed by `signer`.
 * `priceYocto`, when passed, is the registry price: below it is ERR_DEPOSIT_LOW, and a deposit that
 * cannot pay for the new record is ERR_STORAGE_COST. Neither creates a request. Callers that omit
 * the price are planting a row (the dashboard's zero-yocto mock payment, or a test of the API's own
 * deposit check). A hash that is already registered is ERR_HASH_USED. Returns the tx hash.
 * The payer account is recorded so a later delete makes `refund` bounce.
 */
export async function payRequestReview(db: Db, input: {
  signer: string; receiver: string; requestHash: string; depositYocto: string; priceYocto?: string; seed?: string;
}): Promise<string> {
  requireHash(input.requestHash);
  const deposit = yocto(input.depositYocto);
  if (input.priceYocto !== undefined) {
    const price = yocto(input.priceYocto);
    if (deposit < price) throw new ChainRejectedError('ERR_DEPOSIT_LOW');
    if (deposit < REQUEST_STORAGE_YOCTO) throw new ChainRejectedError('ERR_STORAGE_COST');
  }
  const txHash = mockTxHash(`request_review:${input.requestHash}:${input.signer}:${input.depositYocto}:${input.seed ?? ''}`);
  return withTransaction(poolOf(db), async (client) => {
    const inserted = await client.query(
      `INSERT INTO mock_chain_request (request_hash, account, deposit, status, block_height)
       VALUES ($1, $2, $3, 'Pending', (SELECT count(*) + 1 FROM mock_chain_tx)) ON CONFLICT (request_hash) DO NOTHING`,
      [input.requestHash, input.signer, input.depositYocto]);
    if (inserted.rowCount !== 1) throw new ChainRejectedError('ERR_HASH_USED');
    await client.query(
      `INSERT INTO mock_chain_account (account, code_hash) VALUES ($1, $2) ON CONFLICT (account) DO NOTHING`,
      [input.signer, EMPTY_CODE_HASH]);
    await client.query(
      `INSERT INTO mock_chain_tx (tx_hash, signer, receiver, method, args, deposit, success)
       VALUES ($1, $2, $3, 'request_review', $4, $5, true)`,
      [txHash, input.signer, input.receiver, JSON.stringify({ request_hash: input.requestHash }), input.depositYocto]);
    await client.query(`INSERT INTO mock_chain_event (event, request_hash, data) VALUES ('review_requested', $1, $2)`,
      [input.requestHash, JSON.stringify({ account: input.signer, deposit: input.depositYocto })]);
    return txHash;
  });
}

/** `locked` is open deposits; `earned` is Done deposits. A bounced refund is open again. */
export async function mockBalances(db: Db): Promise<{ locked: bigint; earned: bigint }> {
  const result = await db.query<{ locked: string; earned: string }>(
    `SELECT coalesce(sum(deposit) FILTER (WHERE status IN ('Pending', 'Running')), 0)::numeric(40,0)::text AS locked,
            coalesce(sum(deposit) FILTER (WHERE status = 'Done'), 0)::numeric(40,0)::text AS earned
     FROM mock_chain_request`);
  const row = result.rows[0];
  return { locked: BigInt(row?.locked ?? '0'), earned: BigInt(row?.earned ?? '0') };
}

/** Owner. Removes the report and emits `report_retracted`. */
export async function retractReport(db: Db, accountId: string, by = 'owner.mock'): Promise<void> {
  const removed = await db.query(
    `WITH removed AS (
       DELETE FROM mock_chain_report WHERE account = $1
       RETURNING account, evidence_uri, reason, reporter)
     INSERT INTO mock_chain_event (event, request_hash, data)
     SELECT 'report_retracted', '', jsonb_build_object(
       'by', $2::text,
       'report', jsonb_build_object('account_id', account, 'evidence_uri', evidence_uri, 'reason', reason, 'reporter', reporter))
     FROM removed`,
    [accountId, by]);
  if (removed.rowCount !== 1) throw new ChainRejectedError('ERR_NOT_REPORTED');
}

/** The deployed account confirms the attestation. Emits `binding_confirmed`. */
export async function confirmBinding(db: Db, requestHash: string, accountId: string): Promise<void> {
  requireHash(requestHash);
  const updated = await db.query(
    `WITH updated AS (
       UPDATE mock_chain_attestation SET binding_confirmed = true
       WHERE request_hash = $1 AND deployed = $2 AND NOT binding_confirmed
       RETURNING request_hash, deployed, repo, commit_sha, code_hash)
     INSERT INTO mock_chain_event (event, request_hash, data)
     SELECT 'binding_confirmed', request_hash, jsonb_build_object(
       'request_hash', request_hash, 'deployed', deployed, 'repo', repo, 'commit', commit_sha, 'code_hash', code_hash)
     FROM updated`,
    [requestHash, accountId]);
  if (updated.rowCount === 1) return;
  const found = await db.query<{ deployed: string | null; binding_confirmed: boolean }>(
    'SELECT deployed, binding_confirmed FROM mock_chain_attestation WHERE request_hash = $1', [requestHash]);
  const row = found.rows[0];
  if (!row) throw new ChainRejectedError('ERR_NOT_FOUND');
  if (!row.deployed) throw new ChainRejectedError('ERR_NO_DEPLOYED');
  if (row.deployed !== accountId) throw new ChainRejectedError('ERR_NOT_DEPLOYED_ACCOUNT');
  throw new ChainRejectedError('ERR_ALREADY_CONFIRMED');
}

/** An attestation as the contract would hold it after an earlier review (guard tests, local demo). */
export async function seedAttestation(db: Db, a: {
  requestHash: string; repo: string; commit: string; reportSha256: string; reportUri: string; deployed: string; codeHash: string;
  maxSeverity: string; bindingConfirmed: boolean;
}): Promise<void> {
  await db.query(
    `INSERT INTO mock_chain_attestation (request_hash, repo, commit_sha, report_sha256, report_uri, deployed, code_hash, max_severity,
       block_height, block_timestamp_ms, binding_confirmed, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11)`,
    [a.requestHash, a.repo, a.commit, a.reportSha256, a.reportUri, a.deployed, a.codeHash, a.maxSeverity, Date.now(), a.bindingConfirmed,
      mockTxHash(`attest:${a.requestHash}`)]);
}

export async function chainEvents(db: Db, requestHash: string): Promise<string[]> {
  const result = await db.query<{ event: string }>('SELECT event FROM mock_chain_event WHERE request_hash = $1 ORDER BY id', [requestHash]);
  return result.rows.map((row) => row.event);
}
