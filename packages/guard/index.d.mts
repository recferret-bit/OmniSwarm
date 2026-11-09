// Declarations for index.mjs. The runtime is plain ESM with JSDoc checked against these types.
import type { Level, ReasonCode, ChainAttestation, ChainReader, Policy, Signals, SchemaAttestation, Verdict, TxIntent, Target, IntentVerdict, GuardOptions, Guard, RegistryView } from './types.js';

export type * from './types.js';

export function createGuard(options: GuardOptions): Guard;
export function evaluate(signals: Signals, severity: string | null, policy?: Policy): { verdict: Level; reasons: string[] };
export function assertVerdict(value: unknown): Verdict;
export function toSchemaAttestation(attestation: ChainAttestation): SchemaAttestation;
export function httpSource(options: { apiUrl: string; network: 'testnet' | 'mainnet'; apiKey?: string; fetch?: typeof fetch }): (accountId: string) => Promise<Verdict>;
export function registryReader(view: RegistryView): Pick<Required<ChainReader>, 'getAttestationForAccount' | 'isReported' | 'getReport'>;
export function viewSourceMetadata(
  view: (accountId: string, method: string, args: Record<string, unknown>) => Promise<unknown>,
  accountId: string,
): Promise<unknown>;
export function targetsOf(intent: TxIntent, beneficiaryArgs?: readonly string[]): Target[];
export function isAccountId(value: unknown): value is string;
export const DEFAULT_POLICY: Readonly<Policy>;
export const DEFAULT_BENEFICIARY_ARGS: readonly string[];
export const REASONS: Readonly<Record<ReasonCode, import('./types.js').ReasonLevel>>;
export const REASON_CODES: readonly ReasonCode[];
export const EMPTY_CODE_HASH: string;

export class GuardBlockedError extends Error {
  readonly code: 'GUARD_BLOCK';
  readonly verdict: IntentVerdict;
  constructor(verdict: IntentVerdict);
}

export class GuardWarnDeclinedError extends Error {
  readonly code: 'GUARD_WARN_DECLINED';
  readonly verdict: IntentVerdict;
  constructor(verdict: IntentVerdict);
}

