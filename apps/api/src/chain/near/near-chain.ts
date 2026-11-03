// NearChainAdapter: the registry contract over NEAR JSON-RPC with near-api-js 7. Reads use
// finality "final"; the payment tx is read with wait_until FINAL; operator writes are signed with
// the function-call key from OPERATOR_KEY_FILE (worker only) and wait for FINAL.
import { Account, FailoverRpcError, FailoverRpcProvider, JsonRpcProvider, actions, type Provider } from 'near-api-js';
import { AccessKeyDoesNotExistError, AccountDoesNotExistError, UnknownTransactionError } from 'near-api-js/rpc-errors';
import { ChainRejectedError, chainUnavailable } from '../errors.ts';
import type { AttestArgs, ChainAttestation, ChainPort, ChainRequest, KeyPermission, PaymentTx, ReportAddressArgs } from '../port.ts';
import { fromContractAttestation, type ContractAttestation } from './attestation.ts';
import type { OperatorKey } from './operator-key.ts';
import { panicReason, parsePaymentTx, returnValue } from './payment-tx.ts';

const FINAL = { finality: 'final' } as const;
const GAS = 30_000_000_000_000n;

export interface NearChainOptions {
  rpcUrls: string[];
  contractId: string;
  /** Overrides the key file's account_id. */
  operatorAccountId: string | null;
  /** Worker only: loaded on the first write. The API passes null and can never sign (INTAKE section 5). */
  operator: (() => OperatorKey) | null;
}

function isNotFound(error: unknown): boolean {
  if (error instanceof FailoverRpcError) return error.errors.length > 0 && error.errors.every(isNotFound);
  return error instanceof AccountDoesNotExistError || error instanceof AccessKeyDoesNotExistError || error instanceof UnknownTransactionError;
}

export function createProvider(urls: string[]): Provider {
  return new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url }, { retries: 2, wait: 100, backoff: 2 })));
}

export class NearChainAdapter implements ChainPort {
  readonly kind = 'near';
  readonly contractId: string;
  readonly #provider: Provider;
  readonly #options: NearChainOptions;
  #account: Account | null = null;
  #writes: Promise<unknown> = Promise.resolve();

  constructor(options: NearChainOptions, provider: Provider = createProvider(options.rpcUrls)) {
    this.#options = options;
    this.#provider = provider;
    this.contractId = options.contractId;
  }

  async #read<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      if (isNotFound(error)) return null;
      throw chainUnavailable(error);
    }
  }

  async #view<T>(method: string, args: Record<string, unknown>): Promise<T | null> {
    const value = await this.#read(() => this.#provider.callFunction<never>({ contractId: this.contractId, method, args, blockQuery: FINAL }));
    return (value ?? null) as T | null;
  }

  async health() {
    const rpc = (await this.#read(() => this.#provider.viewBlock(FINAL)).catch(() => null)) !== null;
    const contract = rpc && (await this.getPrice().then(() => true, () => false));
    return { rpc, contract };
  }

  async keyPermission(accountId: string, publicKey: string): Promise<KeyPermission | null> {
    const key = await this.#read(() => this.#provider.viewAccessKey({ accountId, publicKey, finalityQuery: FINAL }));
    if (!key) return null;
    return key.permission === 'FullAccess' ? 'FullAccess' : 'FunctionCall';
  }

  async getPaymentTx(txHash: string, signerId: string): Promise<PaymentTx | null> {
    const response = await this.#read(() => this.#provider.viewTransactionStatus({ txHash, accountId: signerId, waitUntil: 'FINAL' }));
    return response ? parsePaymentTx(txHash, response) : null;
  }

  async getRequest(requestHash: string): Promise<ChainRequest | null> {
    const row = await this.#view<{ account: string; deposit: string; block_height: number; status: ChainRequest['status'] }>(
      'get_request', { request_hash: requestHash });
    if (!row) return null;
    return { account: row.account, depositYocto: BigInt(row.deposit), blockHeight: Number(row.block_height), status: row.status };
  }

  async getAttestation(requestHash: string): Promise<ChainAttestation | null> {
    const row = await this.#view<ContractAttestation>('get_attestation', { request_hash: requestHash });
    return row ? fromContractAttestation(row) : null;
  }

  async getAttestationForAccount(accountId: string): Promise<ChainAttestation | null> {
    const row = await this.#view<ContractAttestation>('get_attestation_for_account', { account: accountId });
    return row ? fromContractAttestation(row) : null;
  }

  async blockTimestampMs(height: number): Promise<number> {
    const block = await this.#read(() => this.#provider.viewBlock({ blockId: height }));
    if (!block) throw chainUnavailable(new Error(`block ${height} not found`));
    return Math.floor(Number(block.header.timestamp_nanosec) / 1e6);
  }

  async getPrice(): Promise<bigint> {
    const price = await this.#view<string>('get_price', {});
    if (price === null) throw chainUnavailable(new Error('get_price returned nothing'));
    return BigInt(price);
  }

  async viewAccount(accountId: string): Promise<{ codeHash: string } | null> {
    const view = await this.#read(() => this.#provider.viewAccount({ accountId, blockQuery: FINAL }));
    return view ? { codeHash: view.code_hash } : null;
  }

  async isReported(accountId: string): Promise<boolean> {
    const reported = await this.#view<unknown>('is_reported', { account_id: accountId });
    if (typeof reported !== 'boolean') throw chainUnavailable(new Error('is_reported did not return a boolean'));
    return reported;
  }

  viewRegistry(method: string, args: Record<string, unknown>): Promise<unknown> {
    return this.#view<unknown>(method, args);
  }

  markRunning(requestHash: string): Promise<string> {
    return this.#call('mark_running', { request_hash: requestHash });
  }

  attest(args: AttestArgs): Promise<string> {
    return this.#call('attest', {
      request_hash: args.requestHash, repo: args.repo, commit: args.commit, report_sha256: args.reportSha256,
      report_uri: args.reportUri, deployed: args.deployed, code_hash: args.codeHash, max_severity: args.maxSeverity,
    });
  }

  // v0.2: refund resolves to false when the transfer bounced; the contract then restored the request.
  refund(requestHash: string): Promise<string> {
    return this.#call('refund', { request_hash: requestHash }, true);
  }

  reportAddress(args: ReportAddressArgs): Promise<string> {
    return this.#call('report_address', { account_id: args.accountId, evidence_uri: args.evidenceUri, reason: args.reason });
  }

  async close(): Promise<void> {}

  #operator(): Account {
    if (this.#account) return this.#account;
    if (!this.#options.operator) throw new Error('this process holds no operator key (OPERATOR_KEY_FILE is worker-only)');
    const key = this.#options.operator();
    const accountId = this.#options.operatorAccountId ?? key.accountId;
    if (!accountId) throw new Error('set OPERATOR_ACCOUNT_ID or use a key file with account_id');
    this.#account = new Account(accountId, this.#provider, key.signer);
    return this.#account;
  }

  // One key signs every write, so writes from this process are serialized to keep its nonce in order.
  #call(method: string, args: Record<string, unknown>, expectTrue = false): Promise<string> {
    const run = this.#writes.then(() => this.#send(method, args, expectTrue));
    this.#writes = run.catch(() => {});
    return run;
  }

  async #send(method: string, args: Record<string, unknown>, expectTrue: boolean): Promise<string> {
    const operator = this.#operator();
    let response: unknown;
    try {
      response = await operator.signAndSendTransaction({
        receiverId: this.contractId, actions: [actions.functionCall(method, args, GAS, 0n)],
        waitUntil: 'FINAL', throwOnFailure: false, retries: 3,
      });
    } catch (error) {
      throw chainUnavailable(error);
    }
    const reason = panicReason(response);
    if (reason) throw new ChainRejectedError(reason);
    if (expectTrue && returnValue(response) !== true) throw new ChainRejectedError('ERR_TRANSFER_FAILED', `${method} transfer did not land`);
    return String((response as { transaction?: { hash?: string } }).transaction?.hash ?? '');
  }
}
