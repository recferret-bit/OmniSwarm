// GET /api/reports/:id (INTAKE section 4, public): the index of a published report. The hash, URL, repository and
// highest severity come from the request row (what was published), the reviewer list and the report files
// from the published copy's manifest (REPORTS_ROOT/<id>/published.json, read-only), and the cross-check
// counts from its findings-and-scores.json. Nothing is estimated.
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../../config/load.ts';
import type { Db } from '../../db/pool.ts';
import { findRequest, listThemes } from '../../db/repositories/requests.ts';
import { fail } from '../../shared/errors.ts';
import { readJson } from '../../worker/classify.ts';
import { readPublished } from '../../worker/publish.ts';
import { maxSeverity, SEVERITIES, type Severity } from '../../worker/report.ts';

export interface ReportIndexDeps { config: Config; pool: Db }

// v2 adjudication plus AGREED, and the legacy statuses the engine still writes when
// finalStatus is absent. DISPUTED and INSUFFICIENT_EVIDENCE are counted in `total` only.
const PASSED = new Set(['CONFIRMED', 'LIKELY', 'REFUTED', 'AGREED', 'UPHELD_REVIEW', 'MODEL_AGREEMENT', 'REFUTED_REVIEW']);

export interface Check { passed: number; total: number }

function idOf(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') return (value as { id: string }).id;
  return null;
}

/** Reviewer ids from either the early string list or the engine's vendor-grouped index. */
function reviewersOf(dir: string): string[] {
  const groups = readJson(path.join(dir, 'reviewers', 'index.json'))?.groups;
  if (!Array.isArray(groups)) return [];
  const ids = groups.flatMap((group: { reviewers?: unknown; vendors?: unknown }) => {
    const direct = Array.isArray(group?.reviewers) ? group.reviewers.flatMap((row) => { const id = idOf(row); return id ? [id] : []; }) : [];
    const vendors = Array.isArray(group?.vendors) ? group.vendors : [];
    const nested = vendors.flatMap((bucket: { reviewers?: unknown }) => (Array.isArray(bucket?.reviewers)
      ? bucket.reviewers.flatMap((row: unknown) => { const id = idOf(row); return id ? [id] : []; })
      : []));
    return [...direct, ...nested];
  });
  return [...new Set(ids)];
}

function findingStatus(row: { finalStatus?: unknown; status?: unknown }): string {
  const status = row.finalStatus ?? row.status;
  return typeof status === 'string' ? status : '';
}

/** CONFIRMED, LIKELY and REFUTED passed the cross-check. Every finding counts toward the total. */
export function checkFromFindings(value: unknown): Check {
  const rows = Array.isArray(value) ? value
    : value && typeof value === 'object' && Array.isArray((value as { findings?: unknown }).findings)
      ? (value as { findings: unknown[] }).findings : [];
  let passed = 0;
  let total = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    total += 1;
    if (PASSED.has(findingStatus(row as { finalStatus?: unknown; status?: unknown }))) passed += 1;
  }
  return { passed, total };
}

function publishedDir(reportsRoot: string, requestId: string): string | null {
  const published = readPublished(reportsRoot, requestId);
  return published && fs.existsSync(published.dir) ? published.dir : null;
}

function checkOf(dir: string | null): Check {
  return checkFromFindings(dir ? readJson(path.join(dir, 'findings-and-scores.json')) : null);
}

/** A split parent publishes an empty index: its counts and severity are those of its done slices. */
async function fromSlices(deps: ReportIndexDeps, parentId: string): Promise<{ check: Check; severity: Severity } | null> {
  const children = (await listThemes(deps.pool, parentId)).filter(
    (child) => child.id !== parentId && (child.debate_rounds === null || child.debate_rounds === undefined) && child.status === 'done',
  );
  if (!children.length) return null;
  const check: Check = { passed: 0, total: 0 };
  let severity: Severity = 'none';
  for (const child of children) {
    const part = checkOf(publishedDir(deps.config.storage.reportsRoot, child.id));
    check.passed += part.passed;
    check.total += part.total;
    const own = (child.max_severity ?? 'none') as Severity;
    if (SEVERITIES.indexOf(own) > SEVERITIES.indexOf(severity)) severity = own;
  }
  return { check, severity };
}

export interface ReportIndexBody {
  requestId: string;
  reportUrl: string;
  reportSha256: string;
  reviewers?: string[];
  generalReviewUrl?: string;
  stage1Url?: string;
  adviceUrl?: string;
  pipelineUrl?: string;
  roundUrls?: string[];
  repo: string;
  maxSeverity: Severity;
  check: Check;
}

export async function reportIndex(deps: ReportIndexDeps, requestId: string): Promise<ReportIndexBody> {
  const row = await findRequest(deps.pool, requestId);
  if (!row) fail('REQUEST_NOT_FOUND', 'Request not found');
  if (row.status !== 'done' || !row.report_sha256 || !row.report_url) fail('NOT_FOUND', 'Report not published yet');
  const base = `${deps.config.storage.reportsBaseUrl}/${row.id}`;
  const published = readPublished(deps.config.storage.reportsRoot, row.id);
  const files = published?.files ?? [];
  const roundUrls = files
    .map((f) => /^audit_round_(\d+)\.html$/.exec(f))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => `${base}/${m[0]}`);
  const dir = publishedDir(deps.config.storage.reportsRoot, row.id);
  const reviewers = dir ? reviewersOf(dir) : [];
  let check = checkOf(dir);
  let severity = (row.max_severity ?? (dir ? maxSeverity(dir) : 'none')) as Severity;
  if (check.total === 0) {
    const slices = await fromSlices(deps, row.id);
    if (slices) ({ check, severity } = slices);
  }
  return {
    requestId: row.id, reportUrl: row.report_url, reportSha256: row.report_sha256,
    ...(reviewers.length ? { reviewers } : {}),
    ...(files.includes('general-review.json') ? { generalReviewUrl: `${base}/general-review.json` } : {}),
    ...(files.includes('audit_stage_1.html') ? { stage1Url: `${base}/audit_stage_1.html` } : {}),
    ...(files.includes('audit_stage_2_advice.html') ? { adviceUrl: `${base}/audit_stage_2_advice.html` }
      : files.includes('orchestrator-advice.json') ? { adviceUrl: `${base}/orchestrator-advice.json` } : {}),
    ...(files.includes('pipeline-progress.json') ? { pipelineUrl: `${base}/pipeline-progress.json` } : {}),
    ...(roundUrls.length ? { roundUrls } : {}),
    repo: row.repo, maxSeverity: severity, check,
  };
}
