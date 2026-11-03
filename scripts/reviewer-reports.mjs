#!/usr/bin/env node
// Derive reviewers/<id>/ from canonical submissions and W04 usage records. Metadata comes only from meta.reviewers;
// jobs are attributed by workers.json `adapter` (or meta.auditors), never by a name prefix.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterOf, readReportJson, writeReportFile } from './report-contract.mjs';
import { validate } from '../packages/schemas/index.mjs';
import { readJsonOr, writeJson, writeText } from './report-util-files.mjs';
import { reportShell } from './report-cards-shell.mjs';
import { loadV2 } from './report-sections/registry.mjs';
import { FAMILY_ORDER } from './report-sections/v2-data.mjs';
import { indexPageHtml, reviewerPageHtml, usageLine } from './reviewer-reports-pages.mjs';
import { loadUsage } from './reviewer-reports-usage.mjs';

export { FAMILY_ORDER };
export const FAMILY_LABELS = { cli: 'Local subscriptions', key: 'API keys', openrouter: 'OpenRouter', scripted: 'Demo (no LLM)', nearai: 'NEAR AI' };
const SURFACE_SLUG = { S1: 's1-auth', S2: 's2-input', S3: 's3-logic', S4: 's4-config', S5: 's5-deps', S6: 's6-client' };
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

function submissionPayload(root, reviewerId, surface) {
  const name = `${reviewerId}-${SURFACE_SLUG[surface]}`;
  const committed = readJsonOr(root, `submissions/${name}.json`, null);
  if (committed) {
    const payload = committed?.report?.payload || committed;
    return { name, payload: Array.isArray(payload) ? payload : [] };
  }
  const auditor = readJsonOr(root, `auditors/${name}.json`, null);
  return Array.isArray(auditor) ? { name, payload: auditor } : null;
}

function jobsOf(reviewerId, workers) {
  return (workers.jobs || []).filter((job) => job.adapter === reviewerId);
}

function expectedSurfaces(reviewerId, workers, meta) {
  const fromJobs = jobsOf(reviewerId, workers).map((job) => String(job.surface?.code || job.surface || '')).filter((s) => /^S[1-6]$/.test(s));
  const fromMeta = (meta.auditors || []).filter((name) => adapterOf(name) === reviewerId).map((name) => `S${/-s([1-6])-/.exec(name)[1]}`);
  const found = [...new Set(fromJobs.length ? fromJobs : fromMeta)].sort();
  return found.length ? found : ['S1'];
}

function gapFor(reviewerId, surface, workers) {
  const job = jobsOf(reviewerId, workers).find((row) => row.name === `${reviewerId}-${SURFACE_SLUG[surface]}`);
  return { surface, reason: job?.failure?.reason || job?.failure?.message || 'not submitted' };
}

function collect(root, reviewer, surfaces, scoredOf, workers) {
  const findings = [];
  const verified = [];
  const gaps = [];
  const covered = [];
  for (const surface of surfaces) {
    const got = submissionPayload(root, reviewer.id, surface);
    if (!got) { gaps.push(gapFor(reviewer.id, surface, workers)); continue; }
    covered.push(surface);
    got.payload.filter((row) => row && row.title).forEach((row, index) => {
      const claimId = `${got.name}#${index}`;
      const scored = scoredOf(claimId);
      findings.push({
        title: String(row.title), surface, severity: row.severity, confidence: row.confidence, location: row.location, impact: row.impact,
        preconditions: row.preconditions ?? '', analysis: row.analysis, validation: row.validation, attack: Array.isArray(row.attack) ? row.attack : [],
        poc: typeof row.poc === 'string' ? row.poc : '', fix: row.fix, claimId, status: scored?.finalStatus || scored?.status || '',
      });
    });
    for (const row of got.payload.find((item) => item && Array.isArray(item.verified_safe))?.verified_safe || []) {
      verified.push({ control: row.control, how_attacked: row.how_attacked || row.evidence || 'Not recorded.', holds: row.holds === true, evidence: row.evidence || row.how_attacked || 'Not recorded.', provenance: row.provenance || 'model_assertion' });
    }
  }
  if (!gaps.length && jobsOf(reviewer.id, workers).some((job) => job.failure?.reason === 'model_mismatch')) gaps.push({ surface: covered[0] || 'S1', reason: 'model_mismatch' });
  return { findings, verified, gaps, covered };
}

export function buildReviewerReport(root, reviewer, { scoredOf, workers, meta }) {
  const surfaces = expectedSurfaces(reviewer.id, workers, meta);
  const { findings, verified, gaps, covered } = collect(root, reviewer, surfaces, scoredOf, workers);
  const usage = loadUsage(root, reviewer.id, covered.length ? covered : surfaces, jobsOf(reviewer.id, workers));
  const identity = { id: reviewer.id, family: reviewer.family, provider: reviewer.provider, vendor: reviewer.vendor, model: reviewer.model, ...(reviewer.servedModel ? { servedModel: reviewer.servedModel } : {}), ...(reviewer.keyFingerprint ? { keyFingerprint: reviewer.keyFingerprint } : {}) };
  const report = {
    reviewer: identity, status: gaps.length ? 'INCOMPLETE' : 'COMPLETE', gaps, surfaces: covered, findings, verified_safe: verified,
    usage: { passes: usage.passes.length, calls: usage.totals.calls, cost: usage.totals.cost, costSource: usage.totals.costSource },
  };
  const check = validate('reviewer-report', report);
  if (!check.ok) throw new Error(`${reviewer.id}: ${check.errors[0]}`);
  return { reviewer: identity, report, usage };
}

function reportMarkdown({ reviewer, report, usage }) {
  const lines = [`# ${reviewer.id}`, '', usageLine(reviewer, usage), '', '## Findings', '', '| Severity | Title | Location | Status |', '|---|---|---|---|',
    ...report.findings.map((f) => `| ${f.severity} | ${f.title} | ${f.location.join(', ')} | ${f.status || ''} |`), '', '## Verified safe', '', ...report.verified_safe.map((row) => `- ${row.control}`)];
  if (report.gaps.length) lines.push('', '## Gaps', '', ...report.gaps.map((gap) => `- ${gap.surface}: ${gap.reason}`));
  return `${lines.join('\n')}\n`;
}

const severityCounts = (findings) => Object.fromEntries(SEVERITIES.map((level) => [level, findings.filter((f) => f.severity === level).length]));

// Index row: unique = the reviewer's claims in clusters no other vendor reported; confirmed and refuted come from
// the debate's final status, else the peer-review status.
function indexRow({ reviewer, report, usage }, scoredOf) {
  const scored = report.findings.map((f) => scoredOf(f.claimId)).filter(Boolean);
  const final = (row) => row.finalStatus || row.status;
  return {
    id: reviewer.id, model: reviewer.model, status: report.status, severity: severityCounts(report.findings), findings: report.findings.length,
    uniqueFindings: scored.filter((row) => (row.vendors || []).length <= 1).length,
    confirmed: scored.filter((row) => ['CONFIRMED', 'AGREED', 'UPHELD_REVIEW', 'MODEL_AGREEMENT'].includes(final(row))).length,
    refuted: scored.filter((row) => ['REFUTED', 'REFUTED_REVIEW'].includes(final(row))).length,
    passes: usage.passes.length, calls: usage.totals.calls, tokensIn: usage.totals.tokensIn, tokensOut: usage.totals.tokensOut,
    cost: usage.totals.cost, costSource: usage.totals.costSource, stops: [...new Set(usage.passes.map((pass) => pass.stop))],
    report: `reviewers/${reviewer.id}/report.html`,
  };
}

function groupsOf(built, scoredOf) {
  return FAMILY_ORDER.filter((family) => built.some((row) => row.reviewer.family === family)).map((family) => {
    const rows = built.filter((row) => row.reviewer.family === family);
    const vendors = [...new Set(rows.map((row) => row.reviewer.vendor))].map((vendor) => ({ vendor, reviewers: rows.filter((row) => row.reviewer.vendor === vendor).map((row) => indexRow(row, scoredOf)) }));
    return { family, label: FAMILY_LABELS[family], vendors };
  });
}

function writeRollups(root, built) {
  const rollups = new Map();
  for (const row of built) {
    const key = `${row.reviewer.family}-${row.reviewer.vendor}`;
    const bucket = rollups.get(key) || { family: row.reviewer.family, vendor: row.reviewer.vendor, reviewers: [], findings: [], calls: 0, cost: 0 };
    bucket.reviewers.push(row.reviewer.id);
    bucket.findings.push(...row.report.findings);
    bucket.calls += row.usage.totals.calls;
    bucket.cost += row.usage.totals.cost;
    rollups.set(key, bucket);
  }
  for (const [key, b] of rollups) {
    const body = { family: b.family, vendor: b.vendor, reviewers: b.reviewers, severity: severityCounts(b.findings), uniqueFindings: b.findings.length, calls: b.calls, cost: Math.round(b.cost * 1000) / 1000 };
    writeJson(root, `reviewers/by-provider/${key}.json`, body);
    writeText(root, `reviewers/by-provider/${key}.md`, `# ${key}\n\n${b.reviewers.join(', ')}\n\n${b.findings.length} findings · ${b.calls} calls · $${body.cost.toFixed(2)}\n`);
  }
}

function writeReviewer(root, built, html) {
  const dir = `reviewers/${built.reviewer.id}`;
  fs.mkdirSync(path.join(root, dir, 'passes'), { recursive: true });
  writeJson(root, `${dir}/report.json`, built.report);
  writeText(root, `${dir}/report.md`, reportMarkdown(built));
  writeReportFile(root, `${dir}/report.html`, html);
  writeJson(root, `${dir}/usage.json`, { passes: built.usage.passes, totals: built.usage.totals });
  for (const pass of built.usage.passes) writeJson(root, `${dir}/passes/pass-${pass.k}.json`, pass);
}

export function deriveReviewerReports(root) {
  const meta = readReportJson(root, 'meta.json');
  if (!Array.isArray(meta.reviewers) || !meta.reviewers.length) throw new Error('meta.reviewers is missing');
  const scores = readJsonOr(root, 'findings-and-scores.json', []);
  const rows = Array.isArray(scores) ? scores : scores?.findings || [];
  const scoredOf = (claimId) => rows.find((row) => (row.claimIds || []).includes(claimId)) || null;
  const workers = readJsonOr(root, 'workers.json', { jobs: [] });
  const built = meta.reviewers.map((reviewer) => buildReviewerReport(root, reviewer, { scoredOf, workers, meta }));
  const groups = groupsOf(built, scoredOf);
  const index = { groups, totals: { findings: rows.length, reviewers: built.length }, pages: ['reviewers.html', ...built.map((row) => `reviewers/${row.reviewer.id}/report.html`)] };
  const indexCheck = validate('reviewers-index', index);
  if (!indexCheck.ok) throw new Error(indexCheck.errors[0]);
  writeJson(root, 'reviewers/index.json', index);
  const v2 = loadV2(root);
  const shell = reportShell({ meta, targetName: meta.name || path.basename(path.resolve(root)), expected: (meta.auditors || []).length, findingsTotal: rows.length, v2 });
  for (const row of built) writeReviewer(root, row, reviewerPageHtml(shell, v2, { ...row, scoredOf }));
  writeReportFile(root, 'reviewers.html', indexPageHtml(shell, groups));
  writeRollups(root, built);
  return { reviewers: built.map((row) => row.reviewer.id), index };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || '');
  deriveReviewerReports(root);
  process.stdout.write(`reviewers written under ${root}/reviewers\n`);
}
