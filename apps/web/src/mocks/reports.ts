// Dev/e2e only. The published report files of a mock request and their hash.
// reportSha256 is digestReport over the mock report files, so the app's in-browser
// verification (fetch the files, recompute, compare) runs unchanged against it.
import { digestReport } from '@omniswarm/schemas/canonical-json';
import findings from '../../public/sample/findings-and-scores.json';
import general from '../../public/sample/general-review.json';

export const REPORTS_ORIGIN = 'https://reports.omniswarm.mock';

export function reportBase(id: string): string {
  return `${REPORTS_ORIGIN}/${id}/`;
}

export function reportFiles(tampered: boolean): { findings: unknown; general: unknown } {
  if (!tampered) return { findings, general };
  const [first, ...rest] = findings.findings;
  return { findings: { findings: [{ ...first, severity: 'low', title: `${first?.title} (edited after publishing)` }, ...rest] }, general };
}

let hash: Promise<string> | null = null;

/** The hash the API serves as reportSha256: always over the untampered files. */
export function mockReportSha256(): Promise<string> {
  hash ??= digestReport(findings, general);
  return hash;
}
