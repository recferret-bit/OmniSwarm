// In-browser report verification: fetch the published report files, hash them
// with @omniswarm/schemas/canonical-json (the same bytes the worker hashed) and
// compare with the reportSha256 the API serves for the request.
import { digestReport } from '@omniswarm/schemas/canonical-json';
import type { ReportIndexResponse } from '../api/schema.gen';

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
  | { state: 'match' | 'mismatch'; expected: string }
  // The API served no hash for this report, so there is nothing to compare with.
  | { state: 'unhashed' }
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

export function compareHash(report: LoadedReport, expected: string | null | undefined): Verification {
  if (!expected) return { ...report, state: 'unhashed' };
  return { ...report, state: expected === report.computed ? 'match' : 'mismatch', expected };
}

/** Hashes the published files in this browser and compares with the hash the API serves. */
export async function verifyReport(files: ReportFiles, reportSha256: string | null | undefined, deps: { fetcher?: Fetcher } = {}): Promise<Verification> {
  return compareHash(await loadReport(files, deps.fetcher), reportSha256);
}
