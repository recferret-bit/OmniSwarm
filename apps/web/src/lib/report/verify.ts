// In-browser report verification (W11-15): fetch the canonical report files,
// hash them with @omniswarm/schemas/canonical-json (the bytes the intake worker
// attests) and compare with the attestation the contract returns.
// The read is get_attestation on NEXT_PUBLIC_RPC_URL. If that call throws, the
// caller may supply the attestation from GET /api/reports/:id. That result is
// still match or mismatch, and it is labelled as not an independent chain read.
import { digestReport } from '@omniswarm/schemas/canonical-json';
import type { Attestation, ReportIndexResponse } from '../api/schema.gen';
import { getAttestation, type OnChainAttestation } from '../near/rpc';

export interface ReportFiles {
  findingsUrl: string;
  generalUrl: string;
}

export interface LoadedReport {
  findings: unknown;
  general: unknown;
  computed: string;
}

export const API_ATTESTATION_LABEL = 'via API, not independent';

export type Verification = LoadedReport & (
  | {
    state: 'match' | 'mismatch';
    attestation: OnChainAttestation;
    source?: 'rpc' | 'api';
    label?: typeof API_ATTESTATION_LABEL;
  }
  | { state: 'unattested' }
);

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type SuppliedAttestation = OnChainAttestation | Attestation;

export function reportFiles(index: Pick<ReportIndexResponse, 'reportUrl' | 'generalReviewUrl'>): ReportFiles {
  return {
    findingsUrl: new URL('findings-and-scores.json', index.reportUrl).toString(),
    generalUrl: index.generalReviewUrl ?? new URL('general-review.json', index.reportUrl).toString(),
  };
}

export async function fetchJson(url: string, fetcher: Fetcher = fetch): Promise<unknown> {
  const response = await fetcher(url, { credentials: 'omit', cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

export async function loadReport(files: ReportFiles, fetcher?: Fetcher): Promise<LoadedReport> {
  const [findings, general] = await Promise.all([fetchJson(files.findingsUrl, fetcher), fetchJson(files.generalUrl, fetcher)]);
  return { findings, general, computed: await digestReport(findings, general) };
}

export function compareAttestation(report: LoadedReport, attestation: OnChainAttestation | null): Verification {
  if (!attestation) return { ...report, state: 'unattested' };
  return { ...report, state: attestation.report_sha256 === report.computed ? 'match' : 'mismatch', attestation };
}

// GET /api/reports/:id uses camelCase. The chain view is snake_case. Missing
// chain-only fields stay empty: this copy is not an independent chain read.
function asOnChain(value: SuppliedAttestation): OnChainAttestation {
  if ('report_sha256' in value) return value;
  return {
    request_hash: value.requestHash,
    repo: value.repo ?? '',
    commit: value.commit ?? '',
    report_sha256: value.reportSha256,
    report_uri: value.reportUri,
    deployed: value.deployed ?? null,
    code_hash: value.codeHash ?? null,
    max_severity: value.maxSeverity,
    block_height: value.blockHeight ?? 0,
    block_timestamp_ms: value.blockTimestampMs ?? 0,
    binding_confirmed: value.bindingConfirmed ?? false,
  };
}

function withSource(result: Verification, source: 'rpc' | 'api'): Verification {
  if (result.state === 'unattested') return result;
  if (source === 'rpc') return { ...result, source };
  return { ...result, source, label: API_ATTESTATION_LABEL };
}

export async function verifyReport(
  files: ReportFiles,
  requestHash: string,
  deps: {
    fetcher?: Fetcher;
    attestationOf?: (hash: string) => Promise<OnChainAttestation | null>;
    apiAttestation?: SuppliedAttestation | null;
  } = {},
): Promise<Verification> {
  const reportPromise = loadReport(files, deps.fetcher);
  const read = deps.attestationOf ?? getAttestation;
  let attestation: OnChainAttestation | null;
  let source: 'rpc' | 'api' = 'rpc';
  try {
    attestation = await read(requestHash);
  } catch (error) {
    if (!deps.apiAttestation) {
      await reportPromise.catch(() => undefined);
      throw error;
    }
    attestation = asOnChain(deps.apiAttestation);
    source = 'api';
  }
  return withSource(compareAttestation(await reportPromise, attestation), source);
}
