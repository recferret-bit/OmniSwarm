// MockChainAdapter: the registry contract simulated on Postgres tables (migration 002). Test and
// local-demo only; container.ts refuses it when NODE_ENV=production. It mirrors the contract's status
// rules (lib.rs) so the worker's idempotency is exercised against the same panics.
import crypto from 'node:crypto';
import { b58encode } from '@omniswarm/schemas/nep413';
import type { Db, Pool } from '../../db/pool.ts';
import { AppError } from '../../shared/errors.ts';
import { ChainRejectedError, chainUnavailable } from '../errors.ts';
import type { AttestArgs, ChainAttestation, ChainPort, ChainRequest, KeyPermission, PaymentTx } from '../port.ts';
import { fromContractAttestation, type ContractAttestation } from '../near/attestation.ts';

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

  async getPaymentTx(txHash: string): Promise<PaymentTx | null> {
    await this.#guard();
    const result = await this.#db.query('SELECT * FROM mock_chain_tx WHERE tx_hash = $1', [txHash]);
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
    return this.#transition(requestHash, 'mark_running', ['Pending'], 'Running', {}, async () => {});
  }

  async attest(args: AttestArgs): Promise<string> {
    await this.#guard();
    if ((args.deployed === null) !== (args.codeHash === null)) throw new ChainRejectedError('ERR_DEPLOYED_PAIR');
    const txHash = await this.#transition(args.requestHash, 'attest', ['Pending', 'Running'], 'Done', args, async (client, tx) => {
      // As in the contract: the binding is confirmed when the deployed account paid for the review.
      await client.query(
        `INSERT INTO mock_chain_attestation (request_hash, repo, commit_sha, report_sha256, report_uri, deployed, code_hash, max_severity,
           block_height, block_timestamp_ms, binding_confirmed, tx_hash)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8, (SELECT count(*) FROM mock_chain_tx), $9, r.account = $6, $10
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
    const txHash = await this.#transition(requestHash, 'refund', ['Pending', 'Running'], 'Refunded', {}, async (client) => {
      await client.query(`INSERT INTO mock_chain_event (event, request_hash, data) VALUES ('review_refunded', $1, '{}')`, [requestHash]);
    });
    await this.#hang('refund');
    return txHash;
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
