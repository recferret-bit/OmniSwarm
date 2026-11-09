// MockChainAdapter: the registry contract simulated on Postgres tables (src/chain/mock/migrations,
// applied only for CHAIN_ADAPTER=mock). Test and local-demo only; container.ts refuses it when
// NODE_ENV=production. It mirrors the contract's status rules (lib.rs) so the worker's idempotency is
// exercised against the same panics.
import crypto from 'node:crypto';
import { b58encode } from '@omniswarm/schemas/nep413';
import type { Db, Pool } from '../../db/pool.ts';
import { AppError } from '../../shared/errors.ts';
import { ChainRejectedError, chainUnavailable } from '../errors.ts';
import type { AttestArgs, ChainAttestation, ChainPort, ChainRequest, KeyPermission, PaymentTx, ReportAddressArgs } from '../port.ts';
import { fromContractAttestation, toContractAttestation, type ContractAttestation } from '../near/attestation.ts';
import {
  requireCommit, requireDeployment, requireEvidenceUri, requireHash, requireReason, requireRepo, requireReportSha256, requireReportUri, requireSeverity,
} from './mock-validate.ts';

export interface MockChainOptions {
  contractId: string;
  priceYocto: string;
  failRate: number;
  /** Test hook: never return after this write lands, so a test can kill the process mid-call. */
  hangAfter: 'attest' | 'refund' | null;
}

const ATTESTATION_COLUMNS = `request_hash, repo, commit_sha AS commit, report_sha256, report_uri, deployed, code_hash, max_severity,
  block_height::int AS block_height, block_timestamp_ms::float8 AS block_timestamp_ms, binding_confirmed`;

export function mockTxHash(seed: string): string {
  return b58encode(crypto.createHash('sha256').update(seed).digest());
}

export class MockChainAdapter implements ChainPort {
  readonly kind = 'mock';
  readonly contractId: string;
  readonly #db: Pool;
  readonly #options: MockChainOptions;

  constructor(db: Pool, options: MockChainOptions) {
    this.#db = db;
    this.#options = options;
    this.contractId = options.contractId;
  }

  async #guard(): Promise<void> {
    if (this.#options.failRate > 0 && Math.random() < this.#options.failRate) throw chainUnavailable(new Error('mock failure injection'));
  }

  async #hang(after: 'attest' | 'refund'): Promise<void> {
    if (this.#options.hangAfter === after) await new Promise<never>(() => {});
  }

  async health() {
    await this.#db.query('SELECT 1');
    return { rpc: true, contract: true };
  }

  async keyPermission(accountId: string, publicKey: string): Promise<KeyPermission | null> {
    await this.#guard();
    const row = await this.#db.query<{ permission: KeyPermission }>(
      'SELECT permission FROM mock_chain_key WHERE account = $1 AND public_key = $2', [accountId, publicKey]);
    return row.rows[0]?.permission ?? null;
  }

  async getPaymentTx(txHash: string, signerId: string): Promise<PaymentTx | null> {
    await this.#guard();
    // Same lookup as the tx RPC: the hash is only visible for the account that signed it.
    const result = await this.#db.query('SELECT * FROM mock_chain_tx WHERE tx_hash = $1 AND signer = $2', [txHash, signerId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      txHash, succeeded: row.success, signerId: row.signer, receiverId: row.receiver,
      requestHash: row.method === 'request_review' ? String(row.args.request_hash ?? '') || null : null,
      depositYocto: BigInt(row.deposit),
    };
  }

  async getRequest(requestHash: string): Promise<ChainRequest | null> {
    await this.#guard();
    return readRequest(this.#db, requestHash);
  }

  async getAttestation(requestHash: string): Promise<ChainAttestation | null> {
    await this.#guard();
    const result = await this.#db.query<ContractAttestation>(
      `SELECT ${ATTESTATION_COLUMNS} FROM mock_chain_attestation WHERE request_hash = $1`, [requestHash]);
    return result.rows[0] ? fromContractAttestation(result.rows[0]) : null;
  }

  async getAttestationForAccount(accountId: string): Promise<ChainAttestation | null> {
    await this.#guard();
    const result = await this.#db.query<ContractAttestation>(
      `SELECT ${ATTESTATION_COLUMNS} FROM mock_chain_attestation WHERE deployed = $1 AND binding_confirmed ORDER BY block_height DESC LIMIT 1`,
      [accountId]);
    return result.rows[0] ? fromContractAttestation(result.rows[0]) : null;
  }

  async blockTimestampMs(): Promise<number> {
    await this.#guard();
    return Date.now();
  }

  async getPrice(): Promise<bigint> {
    await this.#guard();
    return BigInt(this.#options.priceYocto);
  }

  async viewAccount(accountId: string): Promise<{ codeHash: string } | null> {
    await this.#guard();
    const result = await this.#db.query<{ code_hash: string }>('SELECT code_hash FROM mock_chain_account WHERE account = $1', [accountId]);
    return result.rows[0] ? { codeHash: result.rows[0].code_hash } : null;
  }

  async markRunning(requestHash: string): Promise<string> {
    await this.#guard();
    requireHash(requestHash);
    return this.#transition(requestHash, 'mark_running', ['Pending'], 'Running', {}, async (client) => {
      await client.query(`INSERT INTO mock_chain_event (event, request_hash, data) VALUES ('review_running', $1, '{}')`, [requestHash]);
    });
  }

  async attest(args: AttestArgs): Promise<string> {
    await this.#guard();
    requireRepo(args.repo);
    requireCommit(args.commit);
    requireReportSha256(args.reportSha256);
    requireReportUri(args.reportUri);
    requireDeployment(args.deployed, args.codeHash);
    requireSeverity(args.maxSeverity);
    requireHash(args.requestHash);
    const txHash = await this.#transition(args.requestHash, 'attest', ['Pending', 'Running'], 'Done', args, async (client, tx) => {
      // As in the contract: the binding is confirmed when the deployed account paid for the review.
      await client.query(
        `INSERT INTO mock_chain_attestation (request_hash, repo, commit_sha, report_sha256, report_uri, deployed, code_hash, max_severity,
           block_height, block_timestamp_ms, binding_confirmed, tx_hash)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8, (SELECT count(*) FROM mock_chain_tx), $9, coalesce(r.account = $6, false), $10
         FROM mock_chain_request r WHERE r.request_hash = $1`,
        [args.requestHash, args.repo, args.commit, args.reportSha256, args.reportUri, args.deployed, args.codeHash, args.maxSeverity, Date.now(), tx]);
      await client.query(`INSERT INTO mock_chain_event (event, request_hash, data) VALUES ('review_attested', $1, $2)`,
        [args.requestHash, JSON.stringify({ report_sha256: args.reportSha256 })]);
    });
    await this.#hang('attest');
    return txHash;
  }

  async refund(requestHash: string): Promise<string> {
    await this.#guard();
    requireHash(requestHash);
    const client = await this.#db.connect();
    let txHash = '';
    let bounced = false;
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: ChainRequest['status']; account: string; deposit: string }>(
        'SELECT status, account, deposit::text AS deposit FROM mock_chain_request WHERE request_hash = $1 FOR UPDATE', [requestHash]);
      const row = current.rows[0];
      if (!row) throw new ChainRejectedError('ERR_NOT_FOUND');
      if (row.status !== 'Pending' && row.status !== 'Running') throw new ChainRejectedError('ERR_BAD_STATUS');
      const previous = row.status;
      txHash = mockTxHash(`refund:${requestHash}`);
      await client.query(`UPDATE mock_chain_request SET status = 'Refunded' WHERE request_hash = $1`, [requestHash]);
      const event = { request_hash: requestHash, account: row.account, deposit: row.deposit, status: previous };
      await client.query(`INSERT INTO mock_chain_event (event, request_hash, data) VALUES ('review_refunded', $1, $2)`, [requestHash, JSON.stringify(event)]);
      // The parity test deletes the account row. A missing account is the transfer bounce.
      const account = await client.query('SELECT 1 FROM mock_chain_account WHERE account = $1', [row.account]);
      bounced = (account.rowCount ?? 0) === 0;
      if (bounced) {
        await client.query('UPDATE mock_chain_request SET status = $2 WHERE request_hash = $1', [requestHash, previous]);
        await client.query(`INSERT INTO mock_chain_event (event, request_hash, data) VALUES ('refund_failed', $1, $2)`, [requestHash, JSON.stringify(event)]);
      }
      await client.query(
        `INSERT INTO mock_chain_tx (tx_hash, signer, receiver, method, args, success) VALUES ($1, 'operator.mock', $2, 'refund', $3, $4)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [txHash, this.contractId, JSON.stringify({ request_hash: requestHash }), !bounced]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof ChainRejectedError || error instanceof AppError) throw error;
      throw chainUnavailable(error);
    } finally {
      client.release();
    }
    await this.#hang('refund');
    if (bounced) throw new ChainRejectedError('ERR_TRANSFER_FAILED', 'refund transfer did not land');
    return txHash;
  }

  async isReported(accountId: string): Promise<boolean> {
    await this.#guard();
    return (await this.#report(accountId)) !== null;
  }

  /** The registry views the guard reads (INTERFACE.md v0.3.0), answered from the mock tables. */
  async viewRegistry(method: string, args: Record<string, unknown>): Promise<unknown> {
    const accountId = String(args.account_id ?? args.account ?? '');
    if (method === 'is_reported') return this.isReported(accountId);
    if (method === 'get_report') return this.#guard().then(() => this.#report(accountId));
    if (method === 'get_attestation_for_account') {
      const attestation = await this.getAttestationForAccount(accountId);
      return attestation ? toContractAttestation(attestation) : null;
    }
    throw chainUnavailable(new Error(`the mock registry has no view ${method}`));
  }

  async #report(accountId: string) {
    const result = await this.#db.query(
      `SELECT account AS account_id, evidence_uri, reason, reporter, (extract(epoch FROM reported_at) * 1000)::bigint::float8 AS reported_at_ms
       FROM mock_chain_report WHERE account = $1`, [accountId]);
    return result.rows[0] ?? null;
  }

  /** As in the contract: one report per account, the reporter is the caller, a second one is ERR_ALREADY_REPORTED. */
  async reportAddress(args: ReportAddressArgs): Promise<string> {
    await this.#guard();
    requireEvidenceUri(args.evidenceUri);
    requireReason(args.reason);
    const txHash = mockTxHash(`report_address:${args.accountId}`);
    const caller = 'operator.mock';
    const client = await this.#db.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO mock_chain_report (account, evidence_uri, reason, tx_hash, reporter) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account) DO NOTHING`,
        [args.accountId, args.evidenceUri, args.reason, txHash, caller]);
      if (inserted.rowCount !== 1) throw new ChainRejectedError('ERR_ALREADY_REPORTED');
      await client.query(
        `INSERT INTO mock_chain_tx (tx_hash, signer, receiver, method, args, success) VALUES ($1, $2, $3, 'report_address', $4, true)`,
        [txHash, caller, this.contractId, JSON.stringify({ account_id: args.accountId, evidence_uri: args.evidenceUri, reason: args.reason })]);
      await client.query(`INSERT INTO mock_chain_event (event, request_hash, data) VALUES ('address_reported', '', $1)`,
        [JSON.stringify({ account_id: args.accountId, evidence_uri: args.evidenceUri, reason: args.reason, reporter: caller })]);
      await client.query('COMMIT');
      return txHash;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof ChainRejectedError || error instanceof AppError) throw error;
      throw chainUnavailable(error);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {}

  async #transition(
    requestHash: string, method: string, from: ChainRequest['status'][], to: ChainRequest['status'], args: object,
    effect: (client: Db, txHash: string) => Promise<void>,
  ): Promise<string> {
    const client = await this.#db.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: ChainRequest['status'] }>(
        'SELECT status FROM mock_chain_request WHERE request_hash = $1 FOR UPDATE', [requestHash]);
      const status = current.rows[0]?.status;
      if (!status) throw new ChainRejectedError('ERR_NOT_FOUND');
      if (!from.includes(status)) throw new ChainRejectedError('ERR_BAD_STATUS');
      const txHash = mockTxHash(`${method}:${requestHash}`);
      await client.query('UPDATE mock_chain_request SET status = $2 WHERE request_hash = $1', [requestHash, to]);
      await client.query(
        `INSERT INTO mock_chain_tx (tx_hash, signer, receiver, method, args, success) VALUES ($1, 'operator.mock', $2, $3, $4, true)`,
        [txHash, this.contractId, method, JSON.stringify({ request_hash: requestHash, ...args })]);
      await effect(client, txHash);
      await client.query('COMMIT');
      return txHash;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof ChainRejectedError || error instanceof AppError) throw error;
      throw chainUnavailable(error);
    } finally {
      client.release();
    }
  }
}

export async function readRequest(db: Db, requestHash: string): Promise<ChainRequest | null> {
  const result = await db.query('SELECT * FROM mock_chain_request WHERE request_hash = $1', [requestHash]);
  const row = result.rows[0];
  if (!row) return null;
  return { account: row.account, depositYocto: BigInt(row.deposit), blockHeight: Number(row.block_height), status: row.status };
}
