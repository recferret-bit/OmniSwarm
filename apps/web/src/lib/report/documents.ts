// Defensive readers for the published report documents. They are untrusted
// JSON from the reports origin, so every field is optional and type-checked
// before React renders it (as text, never as HTML).
import type { Severity } from '../api/schema.gen';

export interface FindingRow {
  title: string;
  severity: string;
  status: string;
  surface: string;
  locations: string[];
}

export interface ContributionRow {
  reviewerId: string;
  uniqueConfirmed: number;
  refuted: number;
  toolCalls: number;
}

export interface GeneralReview {
  summary: string;
  riskPosture: string;
  disclaimer: string;
  contributions: ContributionRow[];
  reviewers: string[];
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

export function readFindings(doc: unknown): FindingRow[] {
  return list(record(doc).findings).map((item) => {
    const row = record(item);
    return { title: text(row.title), severity: text(row.severity), status: text(row.status), surface: text(row.surface), locations: list(row.locations).map(text) };
  });
}

export function readGeneralReview(doc: unknown): GeneralReview {
  const root = record(doc);
  const contributions = list(root.contributions).map((item) => {
    const row = record(item);
    return { reviewerId: text(row.reviewerId), uniqueConfirmed: count(row.uniqueConfirmed), refuted: count(row.refuted), toolCalls: count(row.toolCalls) };
  });
  return {
    summary: text(root.executiveSummary),
    riskPosture: text(root.riskPosture),
    disclaimer: text(root.disclaimer),
    contributions,
    reviewers: list(record(root.methodology).reviewers).map(text).filter(Boolean),
  };
}

const SEVERITY_TONE: Record<Severity, 'bad' | 'warn' | 'info' | 'neutral'> = {
  critical: 'bad', high: 'bad', medium: 'warn', low: 'info', info: 'neutral', none: 'neutral',
};

export function severityTone(severity: string): 'bad' | 'warn' | 'info' | 'neutral' {
  return SEVERITY_TONE[severity as Severity] ?? 'neutral';
}
