// In-browser report verification (W11-15): fetch the canonical report files,
// hash them with @omniswarm/schemas/canonical-json (the bytes the intake worker
// attests) and compare with the attestation the contract returns.
import { digestReport } from '@omniswarm/schemas/canonical-json';
import type { ReportIndexResponse } from '../api/schema.gen';
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

export type Verification = LoadedReport & (
  | { state: 'match' | 'mismatch'; attestation: OnChainAttestation }
  | { state: 'unattested' }
);

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

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

export async function verifyReport(
  files: ReportFiles,
  requestHash: string,
  deps: { fetcher?: Fetcher; attestationOf?: (hash: string) => Promise<OnChainAttestation | null> } = {},
): Promise<Verification> {
  const [report, attestation] = await Promise.all([loadReport(files, deps.fetcher), (deps.attestationOf ?? getAttestation)(requestHash)]);
  return compareAttestation(report, attestation);
}
