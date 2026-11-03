// NearChainAdapter: the registry contract over NEAR JSON-RPC with near-api-js 7. Reads use
// finality "final"; the payment tx is read with wait_until FINAL; operator writes are signed with
// the function-call key from NEAR_OPERATOR_KEY_PATH and wait for FINAL.
import { Account, FailoverRpcError, FailoverRpcProvider, JsonRpcProvider, actions, type KeyPairSigner, type Provider } from 'near-api-js';
import { AccessKeyDoesNotExistError, AccountDoesNotExistError, UnknownTransactionError } from 'near-api-js/rpc-errors';
import { ChainRejectedError, chainUnavailable } from '../errors.ts';
import type { AttestArgs, ChainAttestation, ChainPort, ChainRequest, KeyPermission, PaymentTx } from '../port.ts';
import { panicReason, parsePaymentTx } from './payment-tx.ts';

const FINAL = { finality: 'final' } as const;
const GAS = 30_000_000_000_000n;
const NO_CODE = '11111111111111111111111111111111';

export interface NearChainOptions {
  rpcUrls: string[];
  contractId: string;
  operatorAccountId: string | null;
  /** Loaded on the first write, so a read-only API process never touches the key file. */
  operatorSigner: (() => KeyPairSigner) | null;
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
    const row = await this.#view<Record<string, string | null>>('get_attestation', { request_hash: requestHash });
    if (!row) return null;
    return {
      requestHash: String(row.request_hash), repo: String(row.repo), commit: String(row.commit),
      reportSha256: String(row.report_sha256), reportUri: String(row.report_uri), deployed: row.deployed ?? null,
      codeHash: row.code_hash ?? null, maxSeverity: String(row.max_severity),
    };
  }

  async getPrice(): Promise<bigint> {
    const price = await this.#view<string>('get_price', {});
    if (price === null) throw chainUnavailable(new Error('get_price returned nothing'));
    return BigInt(price);
  }

  async viewCodeHash(accountId: string): Promise<string | null> {
    const view = await this.#read(() => this.#provider.viewAccount({ accountId, blockQuery: FINAL }));
    return view && view.code_hash !== NO_CODE ? view.code_hash : null;
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

  refund(requestHash: string): Promise<string> {
    return this.#call('refund', { request_hash: requestHash });
  }

  async close(): Promise<void> {}

  #operator(): Account {
    if (this.#account) return this.#account;
    const { operatorAccountId, operatorSigner } = this.#options;
    if (!operatorAccountId || !operatorSigner) throw new Error('operator writes need NEAR_OPERATOR_ACCOUNT_ID and NEAR_OPERATOR_KEY_PATH');
    this.#account = new Account(operatorAccountId, this.#provider, operatorSigner());
    return this.#account;
  }

  // One key signs every write, so writes from this process are serialized to keep its nonce in order.
  #call(method: string, args: Record<string, unknown>): Promise<string> {
    const run = this.#writes.then(() => this.#send(method, args));
    this.#writes = run.catch(() => {});
    return run;
  }

  async #send(method: string, args: Record<string, unknown>): Promise<string> {
    let response: unknown;
    try {
      response = await this.#operator().signAndSendTransaction({
        receiverId: this.contractId, actions: [actions.functionCall(method, args, GAS, 0n)],
        waitUntil: 'FINAL', throwOnFailure: false, retries: 3,
      });
    } catch (error) {
      throw chainUnavailable(error);
    }
    const reason = panicReason(response);
    if (reason) throw new ChainRejectedError(reason);
    return String((response as { transaction?: { hash?: string } }).transaction?.hash ?? '');
  }
}
