// The registry contract as the intake service sees it (contracts/review-registry/src/lib.rs).
// Adapters: `mock` (Postgres tables, test-only) and `near` (near-api-js against RPC).
// Every adapter error that means "the chain could not be asked" is AppError CHAIN_UNAVAILABLE.

export type KeyPermission = 'FullAccess' | 'FunctionCall';
export type ChainRequestStatus = 'Pending' | 'Running' | 'Done' | 'Refunded';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none';

/** `get_request(request_hash)` */
export interface ChainRequest {
  account: string;
  depositYocto: bigint;
  blockHeight: number;
  status: ChainRequestStatus;
}

/** `get_attestation(request_hash)` */
export interface ChainAttestation {
  requestHash: string;
  repo: string;
  commit: string;
  reportSha256: string;
  reportUri: string;
  deployed: string | null;
  codeHash: string | null;
  maxSeverity: string;
}

/** A FINAL `request_review` payment transaction as read from the chain. */
export interface PaymentTx {
  txHash: string;
  succeeded: boolean;
  signerId: string;
  receiverId: string;
  /** Present only when the tx is a single FunctionCall `request_review`. */
  requestHash: string | null;
  depositYocto: bigint;
}

export interface AttestArgs {
  requestHash: string;
  repo: string;
  commit: string;
  reportSha256: string;
  reportUri: string;
  deployed: string | null;
  codeHash: string | null;
  maxSeverity: Severity;
}

export interface ChainHealth { rpc: boolean; contract: boolean }

export interface ChainPort {
  readonly kind: 'mock' | 'near';
  readonly contractId: string;
  health(): Promise<ChainHealth>;
  /** `view_access_key` at final finality; null when the key does not exist on the account. */
  keyPermission(accountId: string, publicKey: string): Promise<KeyPermission | null>;
  /** Tx status with wait_until FINAL; null when the tx is unknown. */
  getPaymentTx(txHash: string, signerId: string): Promise<PaymentTx | null>;
  getRequest(requestHash: string): Promise<ChainRequest | null>;
  getAttestation(requestHash: string): Promise<ChainAttestation | null>;
  getPrice(): Promise<bigint>;
  /** `view_account(...).code_hash`; null when the account does not exist. */
  viewCodeHash(accountId: string): Promise<string | null>;
  /** Operator calls. Each returns the FINAL tx hash. */
  markRunning(requestHash: string): Promise<string>;
  attest(args: AttestArgs): Promise<string>;
  refund(requestHash: string): Promise<string>;
  close(): Promise<void>;
}
