#!/usr/bin/env node
/**
 * generate-html-report.mjs
 *
 * Scores the current inputs (verify-and-adjudicate.mjs), refreshes reviewers/ for runs that list their
 * reviewers, and writes the standalone pages in the report directory:
 *   report.html              the quorum review (plus the v2 sections when the run has a debate)
 *   findings-by-model.html   each model's own findings, counted by severity
 * reviewers.html and reviewers/<id>/report.html come from reviewer-reports.mjs in the same shell.
 *
 * Usage:
 *   node engine/scripts/generate-html-report.mjs [report-dir]   (default: newest dir under reports/)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adjudicate, printSummary } from './verify-and-adjudicate.mjs';
import { deriveReviewerReports } from './reviewer-reports.mjs';
import { readReportJson, writeReportFile } from './report-contract.mjs';
import { esc } from './report-cards.mjs';
import { reportShell } from './report-cards-shell.mjs';
import { loadV2 } from './report-section-registry.mjs';
import { loadContext } from './generate-html-report-context.mjs';
import { SEVERITY_LEVELS, loadModelRows, modelChart, modelTable } from './generate-html-report-models.mjs';
import { evidencePanels, isolationDetails, validationDetails } from './generate-html-report-evidence.mjs';
import { hero, notice, overviewSections, sectionTitle } from './generate-html-report-overview.mjs';
import { newestReportDir, readJsonOr } from './report-util-files.mjs';

// reviewers/ is derived again after scoring so per-reviewer statuses match findings-and-scores.json. A failure
// is recorded in report-health.json: the run reads INCOMPLETE and the main pages still render.
function refreshReviewerReports(reportDir) {
  const meta = readJsonOr(reportDir, 'meta.json', null);
  if (!Array.isArray(meta?.reviewers) || !meta.reviewers.length) return;
  try { deriveReviewerReports(reportDir); }
  catch (error) {
    const health = readReportJson(reportDir, 'report-health.json');
    health.errors = [...(health.errors || []), `reviewer-reports: ${error.message}`];
    health.state = 'incomplete';
    writeReportFile(reportDir, 'report-health.json', `${JSON.stringify(health, null, 2)}\n`);
  }
}

function reportBody(ctx, v2, models) {
  return `${hero(ctx)}${v2 ? v2.slot('hero') : ''}${notice(ctx)}
  ${overviewSections(ctx, v2)}
  <section id="evidence" aria-label="Evidence and scope">${sectionTitle('03', 'Evidence & scope', 'Full detail on demand')}
    ${evidencePanels(ctx, models.rows)}${v2 ? v2.slot('evidence') : ''}
  </section>`;
}

function legacyModelBody(ctx, models) {
  return `${hero(ctx, true)}${notice(ctx)}${sectionTitle('03', 'Findings by model', 'Before deduplication')}
  <p class="note">Each model’s own claims, before merging. Critical is grouped with high. Counts measure output, not reviewer quality.</p>
  <section class="panel"><ul class="legend">${models.levels.map((level) => `<li><i class="swatch swatch-${SEVERITY_LEVELS.includes(level) ? level : 'other'}" aria-hidden="true"></i>${esc(level)}</li>`).join('')}</ul><div aria-hidden="true">${modelChart(models)}</div></section>
  <section class="panel model-meta"><h2>Severity breakdown</h2><div class="table-scroll">${modelTable(models)}</div></section>
  <details class="panel"><summary>Requested models & validation<span class="meta-label">Identity unverified</span></summary><div class="panel-body">${validationDetails(ctx, models.rows)}${isolationDetails(ctx)}</div></details>`;
}

export async function renderReport(reportDir) {
  printSummary(reportDir, await adjudicate(reportDir));
  refreshReviewerReports(reportDir);
  const ctx = loadContext(reportDir);
  const v2 = loadV2(reportDir);
  const models = loadModelRows(ctx);
  const shell = reportShell({ meta: ctx.meta, targetName: ctx.targetName, expected: ctx.expected, findingsTotal: ctx.counts.total, v2 });
  writeReportFile(reportDir, 'report.html', shell.page(reportBody(ctx, v2, models)));
  // The reviewer-id page replaces the adapter page only when reviewers/index.json has rows.
  const byReviewer = v2?.pages().find((page) => page.rel === 'findings-by-model.html');
  writeReportFile(reportDir, 'findings-by-model.html', byReviewer ? shell.page(byReviewer.body, byReviewer.opts) : shell.page(legacyModelBody(ctx, models), { modelPage: true }));
  return ctx.health;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportDir = process.argv[2] || newestReportDir('auditors');
  if (!reportDir) {
    console.error('No report directory given and none found under reports/');
    process.exit(1);
  }
  const health = await renderReport(reportDir);
  console.log(`Standalone review pages written to ${reportDir}`);
  if (health.state === 'incomplete') process.exitCode = 2;
}
