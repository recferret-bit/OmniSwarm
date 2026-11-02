#!/usr/bin/env node
// Derive reviewers/<id>/ from canonical submissions and W04 usage records. Metadata comes only from meta.reviewers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReportJson, writeReportFile } from './report-contract.mjs';
import { validate } from '../shared/schemas/index.mjs';
import { esc, toneOf } from './report-cards.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FAMILY_ORDER = ['cli', 'key', 'openrouter', 'scripted', 'nearai'];
export const FAMILY_LABELS = {
  cli: 'Local subscriptions',
  key: 'API keys',
  openrouter: 'OpenRouter',
  scripted: 'Demo (no LLM)',
  nearai: 'NEAR AI',
};
const APPROACH = { cli: 'Approach 1 · Local subscription', key: 'Approach 2 · API key', openrouter: 'Approach 3 · OpenRouter', scripted: 'Demo', nearai: 'NEAR AI' };
const SURFACE_SLUG = { S1: 's1-auth', S2: 's2-input', S3: 's3-logic', S4: 's4-config', S5: 's5-deps', S6: 's6-client' };

function readJson(root, rel, fallback) {
  try { return readReportJson(root, rel); } catch { return fallback; }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
}

function submissionPayload(root, reviewerId, surface) {
  const slug = SURFACE_SLUG[surface];
  const names = [`${reviewerId}-${slug}`, `${reviewerId}-${surface.toLowerCase()}`];
  for (const name of names) {
    const file = path.join(root, 'submissions', `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    const payload = body?.report?.payload || body;
    return { name, payload: Array.isArray(payload) ? payload : [] };
  }
  const auditor = path.join(root, 'auditors', `${reviewerId}-${slug}.json`);
  if (fs.existsSync(auditor)) return { name: `${reviewerId}-${slug}`, payload: JSON.parse(fs.readFileSync(auditor, 'utf8')) };
  return null;
}

function claimStatus(scores, claimId) {
  const rows = scores?.findings || scores?.clusters || [];
  return rows.find((row) => (row.claimIds || []).includes(claimId)) || null;
}

function loadUsage(root, reviewerId, surfaces, workers) {
  const dir = path.join(root, 'harness', 'usage', reviewerId);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
  if (!files.length) {
    const passes = surfaces.map((surface, index) => {
      const job = (workers.jobs || []).find((row) => row.name?.startsWith(`${reviewerId}-`) && String(row.surface || row.name).toUpperCase().includes(surface));
      const stop = job?.failure ? 'unknown' : 'submitted';
      return { k: index + 1, index: index + 1, role: 'discover', calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, costSource: 'none', stop, startedAt: '', endedAt: '', surface };
    });
    return { passes, totals: { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, costSource: 'none' }, stub: true };
  }
  const rows = files.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
  const byPass = new Map();
  for (const row of rows) {
    const key = row.k || row.index || 1;
    const bucket = byPass.get(key) || { k: key, index: key, role: row.role || 'discover', calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, costSource: 'none', stop: row.stop || 'submitted', startedAt: row.startedAt || '', endedAt: row.endedAt || '' };
    bucket.calls += Number(row.calls) || 0;
    bucket.tokensIn += Number(row.tokensIn) || 0;
    bucket.tokensOut += Number(row.tokensOut) || 0;
    bucket.cost += Number(row.cost) || 0;
    if (row.costSource === 'reported' || bucket.costSource === 'none') bucket.costSource = row.costSource || bucket.costSource;
    if (row.stop === 'cost' || row.stop === 'error' || row.stop === 'budget') bucket.stop = row.stop;
    byPass.set(key, bucket);
  }
  const passes = [...byPass.values()].sort((a, b) => a.k - b.k);
  const totals = passes.reduce((sum, row) => ({
    calls: sum.calls + row.calls, tokensIn: sum.tokensIn + row.tokensIn, tokensOut: sum.tokensOut + row.tokensOut, cost: Math.round((sum.cost + row.cost) * 1000) / 1000,
    costSource: row.costSource !== 'none' ? row.costSource : sum.costSource,
  }), { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, costSource: 'none' });
  return { passes, totals, stub: false };
}

function expectedSurfaces(reviewerId, workers) {
  const found = new Set();
  for (const job of workers.jobs || []) {
    const match = String(job.name || '').match(new RegExp(`^${reviewerId}-s([1-6])-`));
    if (match) found.add(`S${match[1]}`);
    if (typeof job.surface === 'string' && /^S[1-6]$/.test(job.surface) && String(job.name || '').startsWith(reviewerId)) found.add(job.surface);
  }
  return found.size ? [...found].sort() : ['S1'];
}

function gapFor(reviewerId, surface, workers) {
  const slug = SURFACE_SLUG[surface];
  const job = (workers.jobs || []).find((row) => row.name === `${reviewerId}-${slug}`);
  return { surface, reason: job?.failure?.reason || job?.failure?.message || 'not submitted' };
}

function money(cost) {
  return `$${Number(cost || 0).toFixed(2)}`;
}

function reportMarkdown(reviewer, report, usage) {
  const lines = [
    `# ${reviewer.id}`,
    '',
    `${APPROACH[reviewer.family] || reviewer.family} · vendor ${reviewer.vendor} · model ${reviewer.model}`,
    '',
    `${usage.passes.length} passes · ${usage.totals.calls} calls · ${money(usage.totals.cost)}`,
    '',
    '## Findings',
    '',
    '| Severity | Title | Location | Status |',
    '|---|---|---|---|',
    ...report.findings.map((finding) => `| ${finding.severity} | ${finding.title} | ${finding.location.join(', ')} | ${finding.status || ''} |`),
    '',
    '## Verified safe',
    '',
    ...report.verified_safe.map((row) => `- ${row.control}`),
  ];
  if (report.gaps?.length) {
    lines.push('', '## Gaps', '');
    for (const gap of report.gaps) lines.push(`- ${gap.surface}: ${gap.reason}`);
  }
  return `${lines.join('\n')}\n`;
}

function reviewerHtml(reviewer, report, usage) {
  const styles = fs.readFileSync(path.join(HERE, 'report-style.css'), 'utf8');
  const browser = fs.readFileSync(path.join(HERE, 'report-browser.js'), 'utf8');
  const nonce = 'w05-reviewer-page';
  const strip = `${APPROACH[reviewer.family] || reviewer.family} · vendor ${reviewer.vendor} · model ${reviewer.model} · ${usage.passes.length} passes · ${usage.totals.calls} calls · ${money(usage.totals.cost)}`;
  const cards = report.findings.map((finding, index) => `<details class="finding ${toneOf(finding.severity)}" data-severity="${esc(finding.severity)}" data-surface="${esc(finding.surface)}"><summary><span class="finding-index">${String(index + 1).padStart(2, '0')}</span><div><div class="finding-tags"><span class="pill ${toneOf(finding.severity)}">${esc(finding.severity)}</span><span class="pill">${esc(finding.status || '')}</span></div><h3>${esc(finding.title)}</h3></div></summary><div class="finding-body"><p>${esc(finding.analysis)}</p><code>${esc(finding.location.join(', '))}</code></div></details>`).join('');
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${esc(reviewer.id)}</title><style>${styles}</style></head><body>
<aside class="rail"><a href="../../report.html" class="brand"><span class="emblem"></span><span>OmniSwarm</span></a><nav><a href="../../report.html">Overview</a><a href="../../reviewers.html">Reviewers</a></nav></aside>
<div class="workspace"><main id="main"><p class="eyebrow">${esc(strip)}</p><h1>${esc(reviewer.model)}</h1>${report.status === 'INCOMPLETE' ? `<p class="notice"><b>INCOMPLETE</b> ${esc(report.gaps.map((gap) => `${gap.surface} ${gap.reason}`).join('; '))}</p>` : ''}<div class="toolbar"><div class="filter-group" role="group" aria-label="Filter by severity"></div></div>${cards}</main></div>
<script nonce="${nonce}">${browser}</script></body></html>\n`;
}

function severityCounts(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) if (Object.hasOwn(counts, finding.severity)) counts[finding.severity] += 1;
  return counts;
}

export function deriveReviewerReports(root) {
  const meta = readReportJson(root, 'meta.json');
  const reviewers = meta.reviewers;
  if (!Array.isArray(reviewers) || !reviewers.length) throw new Error('meta.reviewers is missing');
  const scores = readJson(root, 'findings-and-scores.json', { findings: [] });
  const workers = readJson(root, 'workers.json', { jobs: [] });
  const built = [];
  for (const reviewer of reviewers) {
    const surfaces = expectedSurfaces(reviewer.id, workers);
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
        const scored = claimStatus(scores, claimId);
        findings.push({
          title: String(row.title), surface, severity: row.severity, confidence: row.confidence,
          location: row.location, impact: row.impact, preconditions: row.preconditions ?? '',
          analysis: row.analysis, validation: row.validation, attack: Array.isArray(row.attack) ? row.attack : [],
          poc: typeof row.poc === 'string' ? row.poc : '', fix: row.fix, claimId, status: scored?.status || '',
        });
      });
      const controls = got.payload.find((row) => row && Array.isArray(row.verified_safe));
      for (const row of controls?.verified_safe || []) {
        verified.push({
          control: row.control, how_attacked: row.how_attacked || row.evidence || 'Not recorded.',
          holds: row.holds === true, evidence: row.evidence || row.how_attacked || 'Not recorded.',
          provenance: row.provenance || 'model_assertion',
        });
      }
    }
    const failed = (workers.jobs || []).find((job) => String(job.name || '').startsWith(`${reviewer.id}-`) && job.failure);
    if (failed && !gaps.some((gap) => failed.name.includes(gap.surface.toLowerCase().replace('s', 's')))) {
      /* the missing-file gap already names the reason */
    }
    const usage = loadUsage(root, reviewer.id, covered.length ? covered : surfaces, workers);
    const report = {
      reviewer: { id: reviewer.id, family: reviewer.family, provider: reviewer.provider, vendor: reviewer.vendor, model: reviewer.model, ...(reviewer.servedModel ? { servedModel: reviewer.servedModel } : {}), ...(reviewer.keyFingerprint ? { keyFingerprint: reviewer.keyFingerprint } : {}) },
      status: gaps.length || failed?.failure?.reason === 'model_mismatch' ? 'INCOMPLETE' : 'COMPLETE',
      gaps,
      surfaces: covered,
      findings,
      verified_safe: verified,
      usage: { passes: usage.passes.length, calls: usage.totals.calls, cost: usage.totals.cost, costSource: usage.totals.costSource },
    };
    if (failed?.failure?.reason === 'model_mismatch' && !gaps.length) gaps.push({ surface: covered[0] || 'S1', reason: 'model_mismatch' });
    report.gaps = gaps;
    report.status = gaps.length ? 'INCOMPLETE' : 'COMPLETE';
    const check = validate('reviewer-report', report);
    if (!check.ok) throw new Error(`${reviewer.id}: ${check.errors[0]}`);
    const dir = `reviewers/${reviewer.id}`;
    fs.mkdirSync(path.join(root, dir, 'passes'), { recursive: true });
    writeReportFile(root, `${dir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
    writeReportFile(root, `${dir}/report.md`, reportMarkdown(reviewer, report, usage));
    writeReportFile(root, `${dir}/report.html`, reviewerHtml(reviewer, report, usage));
    writeReportFile(root, `${dir}/usage.json`, `${JSON.stringify({ passes: usage.passes, totals: usage.totals }, null, 2)}\n`);
    for (const pass of usage.passes) writeReportFile(root, `${dir}/passes/pass-${pass.k}.json`, `${JSON.stringify(pass, null, 2)}\n`);
    built.push({ reviewer, report, usage });
  }
  const groups = FAMILY_ORDER.filter((family) => built.some((row) => row.reviewer.family === family)).map((family) => {
    const rows = built.filter((row) => row.reviewer.family === family);
    const vendors = [...new Set(rows.map((row) => row.reviewer.vendor))].map((vendor) => ({
      vendor,
      reviewers: rows.filter((row) => row.reviewer.vendor === vendor).map((row) => ({
        id: row.reviewer.id, status: row.report.status, severity: severityCounts(row.report.findings),
        uniqueFindings: row.report.findings.length, calls: row.usage.totals.calls, cost: row.usage.totals.cost,
        report: `reviewers/${row.reviewer.id}/report.html`,
      })),
    }));
    return { family, label: FAMILY_LABELS[family], vendors };
  });
  const pages = ['reviewers.html', ...built.map((row) => `reviewers/${row.reviewer.id}/report.html`)];
  const index = { groups, totals: { findings: (scores.findings || []).length, reviewers: built.length }, pages };
  const indexCheck = validate('reviewers-index', index);
  if (!indexCheck.ok) throw new Error(indexCheck.errors[0]);
  fs.mkdirSync(path.join(root, 'reviewers', 'by-provider'), { recursive: true });
  writeReportFile(root, 'reviewers/index.json', `${JSON.stringify(index, null, 2)}\n`);
  writeReportFile(root, 'reviewers.html', indexHtml(groups));
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
  for (const [key, bucket] of rollups) {
    const body = { family: bucket.family, vendor: bucket.vendor, reviewers: bucket.reviewers, severity: severityCounts(bucket.findings), uniqueFindings: bucket.findings.length, calls: bucket.calls, cost: Math.round(bucket.cost * 1000) / 1000 };
    writeReportFile(root, `reviewers/by-provider/${key}.json`, `${JSON.stringify(body, null, 2)}\n`);
    writeReportFile(root, `reviewers/by-provider/${key}.md`, `# ${key}\n\n${bucket.reviewers.join(', ')}\n`);
  }
  return { reviewers: built.map((row) => row.reviewer.id), index };
}

function indexHtml(groups) {
  const styles = fs.readFileSync(path.join(HERE, 'report-style.css'), 'utf8');
  const sections = groups.map((group) => `<h2>${esc(group.label)}</h2><table><thead><tr><th>Reviewer</th><th>Status</th><th>Findings</th><th>Cost</th></tr></thead><tbody>${group.vendors.flatMap((vendor) => vendor.reviewers).map((row) => `<tr><td><a href="${esc(row.report)}">${esc(row.id)}</a></td><td>${esc(row.status)}</td><td>${row.uniqueFindings}</td><td>${money(row.cost)}</td></tr>`).join('')}</tbody></table>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Reviewers</title><style>${styles}</style></head><body><aside class="rail"><a href="report.html">Overview</a></aside><main><h1>Reviewers</h1>${sections}</main></body></html>\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || '');
  deriveReviewerReports(root);
  process.stdout.write(`reviewers written under ${root}/reviewers\n`);
}
