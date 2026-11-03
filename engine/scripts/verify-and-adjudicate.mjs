#!/usr/bin/env node
/**
 * verify-and-adjudicate.mjs
 *
 * Reads individual auditor JSON reports from a specified directory, clusters claims
 * by shared root cause (cited files/lines, see cluster-findings.mjs), and records model review statements.
 * Scores are heuristic priorities, not execution evidence or calibrated confidence.
 *
 * Legacy title-substring tiebreak files are excluded as untrusted overrides.
 *
 * Cross-check: auditors/crosscheck-<agent>.json is an array of
 *   { id: '<auditor>#<index>', verdict: 'upheld'|'partial'|'refuted', severity?, reason?, evidence? }
 * The id is the auditor file stem plus the index of that finding (objects with a title, skipping verified_safe).
 * A review from the same asserted adapter provider is ignored.
 *
 * When the run has a debate (debate/clusters.json), each row also gets finalStatus, judge, debateRounds and
 * severityReason from debate/adjudication.json (verify-and-adjudicate-debate.mjs).
 *
 * Usage:
 *   node engine/scripts/verify-and-adjudicate.mjs [<report-dir>]   (default: newest dir under reports/)
 *
 * Library: `adjudicate(reportDir)` does the work and returns {scoredFindings, health, verifiedSafe, exitCode}
 * without printing or exiting; the CLI wrapper at the bottom prints and sets the exit code.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clusterFindings, dedupCandidates, isCompoundTitle } from './cluster-findings.mjs';
import { loadAuditors, readReportJson, validCrosscheckRow, writeReportFile } from './report-contract.mjs';
import { reviewersOfMeta, vendorOfJob } from './reviewer-registry.mjs';
import { mergeDebateOutcome } from './verify-and-adjudicate-debate.mjs';
import { newestReportDir } from './report-util-files.mjs';

const SEVERITY_WEIGHT = {
  critical: 10.0,
  high: 8.5,
  medium: 5.5,
  low: 2.5,
  info: 1.0,
};
const QUORUM_MULTIPLIER = { MODEL_AGREEMENT: 0.8, UPHELD_REVIEW: 0.75, PARTIAL_REVIEW: 0.7, REFUTED_REVIEW: 0.0 };

function collectClaims(reports) {
  const allFindings = [];
  const allVerifiedSafe = [];
  for (const { name: auditorName, data } of reports) {
    const findings = data.slice(0, -1).map((x, i) => ({ ...x, claimId: `${auditorName}#${i}` }));
    for (const f of findings) allFindings.push({ ...f, auditor: auditorName });
    for (const s of data.at(-1).verified_safe) allVerifiedSafe.push({ ...s, auditor: auditorName, provenance: 'model_assertion' });
  }
  return { allFindings, allVerifiedSafe };
}

function readJsonArray(reportDir, file, health) {
  try {
    const rows = readReportJson(reportDir, path.relative(reportDir, file));
    if (!Array.isArray(rows) || rows.length > 10_000) throw new Error('expected bounded array');
    return rows;
  } catch {
    health.errors.push('Invalid cross-check JSON was excluded.');
    return [];
  }
}

// Valid cross-check rows by claim id. Invalid, duplicate or unassigned rows are excluded with a health error.
function collectReviews(reportDir, assignments, health) {
  const auditorsDir = path.join(reportDir, 'auditors');
  const reviewsByClaim = new Map();
  for (const file of (fs.existsSync(auditorsDir) ? fs.readdirSync(auditorsDir) : []).filter((f) => f.startsWith('crosscheck-') && f.endsWith('.json'))) {
    const reviewer = file.slice('crosscheck-'.length, -'.json'.length);
    if (!Object.hasOwn(assignments, reviewer)) {
      health.errors.push('Unknown cross-check reviewer was excluded.');
      continue;
    }
    const seen = new Set();
    for (const row of readJsonArray(reportDir, path.join(auditorsDir, file), health)) {
      if (!validCrosscheckRow(row) || !assignments[reviewer].includes(row.id) || seen.has(row.id)) {
        health.errors.push(`${file}: invalid or duplicate cross-check entry was excluded.`);
        continue;
      }
      seen.add(row.id);
      const list = reviewsByClaim.get(String(row.id)) || [];
      list.push({
        claimId: row.id, reviewer, verdict: row.verdict,
        severity: row.severity ? String(row.severity).toLowerCase() : '',
        reason: String(row.reason || '').slice(0, 800),
        evidence: Array.isArray(row.evidence) ? row.evidence.map(String).slice(0, 8) : [],
      });
      reviewsByClaim.set(String(row.id), list);
    }
    if (assignments[reviewer].some((id) => !seen.has(id))) health.errors.push(`${file}: cross-check verdicts do not cover every assigned claim.`);
  }
  return reviewsByClaim;
}

// The peer-review status. Reviews by the claim author's own vendor are ignored.
function applyReview(status, cluster, { reviewsByClaim, claimAuthors, reviewers }) {
  const reviews = [];
  for (const id of cluster.claimIds || []) {
    for (const row of reviewsByClaim.get(id) || []) {
      if (claimAuthors.get(id) === vendorOfJob(row.reviewer, reviewers)) continue;
      reviews.push(row);
    }
  }
  if (!reviews.length) return { status, reviews };
  const upheld = reviews.some((r) => r.verdict === 'upheld');
  const refuted = reviews.some((r) => r.verdict === 'refuted');
  const partial = reviews.some((r) => r.verdict === 'partial');
  let next = status;
  if (refuted && upheld) next = 'PARTIAL_REVIEW';
  else if (refuted && status === 'MODEL_AGREEMENT') next = 'PARTIAL_REVIEW';
  else if (refuted) next = 'REFUTED_REVIEW';
  else if (partial) next = 'PARTIAL_REVIEW';
  else if (upheld && status !== 'MODEL_AGREEMENT') next = 'UPHELD_REVIEW';
  const severities = reviews.map((r) => r.severity).filter((s) => SEVERITY_WEIGHT[s] != null);
  if (next === 'PARTIAL_REVIEW' && severities.length && severities.every((s) => s === severities[0])) {
    cluster.severity = severities[0];
  }
  return { status: next, reviews };
}

function scoreCluster(c, context) {
  const vendorSet = new Set(c.auditors.map(context.authorVendor).filter(Boolean));
  const reviewed = applyReview(vendorSet.size >= 2 ? 'MODEL_AGREEMENT' : 'MODEL_ASSERTION', c, context);
  const status = reviewed.status;
  const finalScore = Number(((SEVERITY_WEIGHT[c.severity] || 5.0) * (QUORUM_MULTIPLIER[status] ?? 0.6)).toFixed(1));
  return {
    clusterId: c.id,
    surface: c.surface,
    title: c.primaryTitle,
    severity: c.severity,
    confidence: c.confidence,
    status,
    score: finalScore,
    vendors: Array.from(vendorSet),
    provenance: 'unverified_adapter_identity',
    executionEvidence: 'not_collected',
    severities: c.severities,
    compound: c.findings.some((f) => isCompoundTitle(f.title)),
    auditorCount: c.auditors.length,
    auditors: c.auditors,
    claimIds: c.claimIds,
    reviews: reviewed.reviews,
    locations: Array.from(new Set(c.findings.flatMap((f) => f.location || []))),
    pocs: c.findings.map((f) => f.poc).filter(Boolean),
    remediation: c.findings[0]?.fix || null,
    // the HTML report reads findings[0] for the harm / attack sections
    findings: c.findings.slice(0, 1).map(({ impact, preconditions, attack }) => ({ impact, preconditions, attack })),
  };
}

export async function adjudicate(reportDir) {
  const { reports, health, assignments, meta } = loadAuditors(reportDir);
  const reviewers = reviewersOfMeta(meta);
  const authorVendor = (job) => vendorOfJob(job, reviewers);
  const initialErrorCount = health.errors.length;
  const { allFindings, allVerifiedSafe } = collectClaims(reports);
  const clusters = clusterFindings(allFindings);
  const dedup = { rawClaims: allFindings.length, clusters: clusters.length, merged: clusters.filter((c) => c.findings.length > 1).length, candidates: dedupCandidates(clusters), compoundClaims: allFindings.filter((f) => isCompoundTitle(f.title)).map((f) => f.claimId) };
  const context = { reviewsByClaim: collectReviews(reportDir, assignments, health), claimAuthors: new Map(allFindings.map((f) => [f.claimId, authorVendor(f.auditor)])), reviewers, authorVendor };
  const scored = clusters.map((c) => scoreCluster(c, context)).sort((a, b) => b.score - a.score);
  const scoredFindings = mergeDebateOutcome(reportDir, scored, SEVERITY_WEIGHT);

  writeReportFile(reportDir, 'findings-and-scores.json', JSON.stringify(scoredFindings, null, 2));
  // controls the auditors attacked that held, for the HTML report
  writeReportFile(reportDir, 'verified-safe.json', JSON.stringify(allVerifiedSafe, null, 2));
  health.dedup = dedup;
  const open = scoredFindings.filter((row) => row.status !== 'REFUTED_REVIEW' && row.finalStatus !== 'REFUTED');
  health.security = { state: open.length ? 'review_required' : 'not_certified', unresolvedClaims: open.length, note: 'Valid reports and passing tests do not certify security or accept residual risks.' };
  if (health.errors.length > initialErrorCount) health.reviewState = 'incomplete';
  health.state = health.errors.length ? 'incomplete' : 'validated_outputs';
  writeReportFile(reportDir, 'report-health.json', `${JSON.stringify(health, null, 2)}\n`);
  return { scoredFindings, health, verifiedSafe: allVerifiedSafe, exitCode: health.state === 'incomplete' ? 2 : 0, auditorCount: reports.length };
}

export function printSummary(reportDir, { scoredFindings, health, auditorCount }) {
  const dedup = health.dedup;
  console.log(`\n======================================================`);
  console.log(` Output validation: ${health.state}; ${scoredFindings.length} model-claim clusters`);
  console.log(` Processed from ${dedup.rawClaims} raw findings across ${auditorCount} auditors (${dedup.merged} merged clusters, ${dedup.candidates.length} unmerged overlap candidates)`);
  console.log(` Findings & scores written to: ${path.join(reportDir, 'findings-and-scores.json')}`);
  console.log(`======================================================\n`);
  console.log('Score'.padEnd(7) + 'Severity'.padEnd(10) + 'Status'.padEnd(22) + 'Vendors'.padEnd(20) + 'Finding');
  console.log('-'.repeat(90));
  for (const f of scoredFindings) {
    console.log(String(f.score).padEnd(7) + f.severity.toUpperCase().padEnd(10) + (f.finalStatus || f.status).padEnd(22) + f.vendors.join(',').padEnd(20) + f.title.slice(0, 50));
  }
  if (health.state === 'incomplete') {
    console.error(health.reviewState === 'validated_outputs'
      ? 'INCOMPLETE VERIFICATION: review outputs validated, but required execution coverage has gaps; this is not a security pass.'
      : 'INCOMPLETE: missing, failed or invalid review outputs; zero findings is not a clean audit.');
    for (const error of health.errors) console.error(`  - ${error}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportDir = process.argv[2] || newestReportDir('auditors');
  if (!reportDir) {
    console.error('No report directory given and none found under reports/');
    process.exit(1);
  }
  const result = await adjudicate(reportDir);
  printSummary(reportDir, result);
  if (result.health.state === 'incomplete') process.exitCode = result.exitCode;
}
