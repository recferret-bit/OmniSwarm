// Public types of @omniswarm/guard. Runtime declarations are in index.d.mts.

export type Level = 'allow' | 'warn' | 'block';

export type ReasonCode =
  | 'REPORTED'
  | 'ATTESTED_CRITICAL_STILL_DEPLOYED'
  | 'CODE_CHANGED_SINCE_REVIEW'
  | 'CONTRACT_NOT_REVIEWED'
  | 'ATTESTATION_STALE'
  | 'ACCOUNT_TOO_NEW'
  | 'SIGNAL_UNAVAILABLE'
  | 'ATTESTED_CLEAN'
  | 'NOT_A_CONTRACT';

/** An attestation as the review-registry contract returns it (contracts/review-registry/INTERFACE.md). */
export interface ChainAttestation {
  request_hash: string;
  repo: string;
  commit: string;
  report_sha256: string;
  report_uri: string;
  deployed: string | null;
  code_hash: string | null;
  max_severity: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none';
  block_height: number;
  /** Block time of the attest call (registry v0.2). Absent in older records: the guard then asks `getBlockTimestampMs`. */
  block_timestamp_ms?: number;
  binding_confirmed: boolean;
}

/** An abuse report as the registry returns it (`get_report`, registry v0.3). */
export interface ChainReport {
  account_id: string;
  reported_at_ms: number;
  evidence_uri: string;
  reason: string;
  reporter: string;
}

/** Port to chain data. Any method may reject; the guard then reports SIGNAL_UNAVAILABLE. */
export interface ChainReader {
  /** `view_account`: null when the account does not exist. */
  getAccount(accountId: string): Promise<{ codeHash: string } | null>;
  /** Registry `get_attestation_for_account` (confirmed bindings only). */
  getAttestationForAccount(accountId: string): Promise<ChainAttestation | null>;
  /** Registry `is_reported {account_id}` (the shared blocklist). Anything but a boolean counts as unavailable. */
  isReported(accountId: string): Promise<boolean>;
  /** Optional. Registry `get_report {account_id}`: the evidence, asked only for a reported account. */
  getReport?(accountId: string): Promise<ChainReport | null>;
  /** Optional, older form of the age signal. `GuardOptions.accountAge` takes precedence. */
  getAccountAgeDays?(accountId: string): Promise<number>;
  /** Block timestamp in milliseconds. Used for freshness only when the attestation has no `block_timestamp_ms`. */
  getBlockTimestampMs(height: number): Promise<number>;
}

/** Optional port for the account-age signal (an indexer). Without one, the age is unavailable. */
export interface AccountAgeSource {
  /** Creation time in ms since the epoch, or null when the source does not know the account. */
  getCreatedAtMs(accountId: string): Promise<number | null>;
}

/** Registry view call at finality `final`: `(method, args) → parsed JSON result`. */
export type RegistryView = (method: string, args: Record<string, unknown>) => Promise<unknown>;

export interface Policy {
  minAgeDays: number;
  maxAttestAgeDays: number;
  severeLevels: readonly string[];
}

export type Signals = {
  account: string;
  exists: boolean | null;
  isContract: boolean | null;
  codeHash: string | null;
  reported: boolean | null;
  ageDays: number | null;
  hasAttestation: boolean | null;
  /** An attestation names this account but the account never confirmed the binding. */
  unconfirmedBinding: boolean;
  attestedCodeHash: string | null;
  codeHashMatches: boolean | null;
  attestationAgeDays: number | null;
  review: { repo: string; commit: string; blockHeight: number } | null;
  /** The registry's evidence for a reported account. Present only when the reader has `getReport` and found one. */
  report?: { evidenceUri: string; reason: string; reportedAtMs: number; reporter: string };
  /** Names of the signals that could not be read. */
  unavailable: string[];
};

/** `attestation.schema.json`. */
export interface SchemaAttestation {
  requestHash: string;
  reportSha256: string;
  reportUri: string;
  deployed: string | null;
  codeHash: string | null;
  maxSeverity: ChainAttestation['max_severity'];
}

/** `intake-api.schema.json#/$defs/guard-verdict-response`. */
export interface Verdict {
  verdict: Level;
  reasons: string[];
  signals: Partial<Signals> & Record<string, unknown>;
  attestation?: SchemaAttestation;
}

export interface WalletAction {
  type?: string;
  params?: { methodName?: string; args?: unknown; deposit?: string; gas?: string };
  functionCall?: { methodName?: string; args?: unknown };
}

/** What a signer is about to send: wallet / near-connect `signAndSendTransaction` params. */
export interface TxIntent {
  signerId?: string;
  receiverId: string;
  actions?: WalletAction[];
}

export interface Target {
  accountId: string;
  role: 'receiver' | 'beneficiary';
  /** `method.arg` for a beneficiary found in function-call args. */
  via?: string;
}

export interface IntentVerdict {
  verdict: Level;
  reasons: string[];
  targets: Array<Target & Verdict>;
}

export interface GuardOptions {
  /** Evaluate locally from chain data. */
  reader?: ChainReader;
  /** Or take verdicts from elsewhere (for example `httpSource`). Used instead of `reader`. */
  source?: (accountId: string) => Promise<Verdict>;
  /** Account-age port. Takes precedence over `reader.getAccountAgeDays`; with neither, age is unavailable. */
  accountAge?: AccountAgeSource;
  policy?: Partial<Policy>;
  /** Local deny list: always `block` with REPORTED. */
  blocklist?: Iterable<string>;
  /** Function-call argument names whose account id is a payee. */
  beneficiaryArgs?: readonly string[];
  now?: () => number;
}

export type OnWarn = (verdict: IntentVerdict) => boolean | Promise<boolean>;

/** Intercepted signer methods. The wrapper exposes only these, and only those the signer has. */
export interface Signer {
  signAndSendTransaction?(params: TxIntent, ...rest: unknown[]): Promise<unknown>;
  signAndSendTransactions?(params: { transactions: TxIntent[] }, ...rest: unknown[]): Promise<unknown>;
  transfer?(params: { receiverId: string; amount: string | bigint }, ...rest: unknown[]): Promise<unknown>;
  callFunction?(params: { contractId: string; methodName: string; args?: unknown; deposit?: string | bigint }, ...rest: unknown[]): Promise<unknown>;
  functionCall?(params: { contractId: string; methodName: string; args?: unknown; deposit?: string | bigint }, ...rest: unknown[]): Promise<unknown>;
}

export interface Guard {
  /** Verdict for one account. Throws TypeError on an invalid account id. */
  check(accountId: string): Promise<Verdict>;
  checkIntent(intent: TxIntent): Promise<IntentVerdict>;
  checkIntents(intents: TxIntent[]): Promise<IntentVerdict>;
  /** `block` throws GuardBlockedError; `warn` proceeds only when `onWarn` resolves to exactly `true`. */
  wrap<S extends Signer>(signer: S, options?: { onWarn?: OnWarn }): Readonly<Pick<S, Extract<keyof S, keyof Signer>>>;
}

/** Recorded chain answers for `createRecordedReader` (`@omniswarm/guard/recorded-reader`). */
export interface RecordedChain {
  accounts?: Record<string, { code_hash: string; age_days?: number }>;
  attestations?: Record<string, ChainAttestation>;
  reported?: string[];
  /** Evidence for `getReport`, by account. An account here counts as reported too. */
  reports?: Record<string, ChainReport>;
  blockTimestampsMs?: Record<string, number>;
}
