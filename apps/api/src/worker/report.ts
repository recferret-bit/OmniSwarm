// What the worker reads out of a finished report: the canonical report hash anyone can recompute
// (W09-11, `scripts/report-hash.ts`) and the max severity of confirmed or likely findings.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { reportDocument } from '@omniswarm/schemas/canonical-json';
import { readJson } from './classify.ts';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none';
/** Ascending. */
export const SEVERITIES: readonly Severity[] = ['none', 'info', 'low', 'medium', 'high', 'critical'];
const ORDER = SEVERITIES;

export function reportSha256(findings: unknown, general: unknown): string {
  return crypto.createHash('sha256').update(reportDocument(findings, general)).digest('hex');
}

/** sha256(canonical(findings-and-scores.json) || canonical(general-review.json ?? {})). */
export function hashReportDir(dir: string): string {
  const findings: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'findings-and-scores.json'), 'utf8'));
  const generalFile = path.join(dir, 'general-review.json');
  const general: unknown = fs.existsSync(generalFile) ? JSON.parse(fs.readFileSync(generalFile, 'utf8')) : {};
  return reportSha256(findings, general);
}

function rank(severity: unknown): number {
  return ORDER.indexOf(String(severity).toLowerCase() as Severity);
}

/** Highest severity among CONFIRMED/LIKELY general-review findings, else unrefuted scored findings. */
export function maxSeverity(dir: string): Severity {
  const general = readJson(path.join(dir, 'general-review.json'));
  let severities: unknown[];
  if (Array.isArray(general?.topFindings)) {
    severities = general.topFindings
      .filter((row: { finalStatus?: unknown }) => row?.finalStatus === 'CONFIRMED' || row?.finalStatus === 'LIKELY')
      .map((row: { severity?: unknown }) => row.severity);
  } else {
    const findings: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'findings-and-scores.json'), 'utf8'));
    const rows = Array.isArray(findings) ? findings : [];
    severities = rows.filter((row: { status?: unknown }) => row?.status !== 'REFUTED_REVIEW').map((row: { severity?: unknown }) => row?.severity);
  }
  const best = Math.max(0, ...severities.map(rank));
  return ORDER[best] ?? 'none';
}
