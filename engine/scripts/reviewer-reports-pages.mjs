// HTML for reviewers.html and reviewers/<id>/report.html, in the shared report shell (report-cards-shell.mjs):
// today's finding cards, the severity filter and search, and a fresh CSP nonce on every render.
import { esc, findingCard, findingsToolbar, severityCounts } from './report-cards.mjs';
import { money, reviewerBadge, usageStrip } from './report-sections/reviewer-badge.mjs';

const APPROACH = { cli: 'Approach 1 · Local subscription', key: 'Approach 2 · API key', openrouter: 'Approach 3 · OpenRouter', scripted: 'Demo', nearai: 'NEAR AI' };

export function usageLine(reviewer, usage) {
  const served = reviewer.servedModel && reviewer.servedModel !== reviewer.model ? ` (served ${reviewer.servedModel})` : '';
  return `${APPROACH[reviewer.family] || reviewer.family} · vendor ${reviewer.vendor} · model ${reviewer.model}${served} · ${usage.passes.length} passes · ${usage.totals.calls} calls · ${money(usage.totals.cost, usage.totals.costSource)}`;
}

// A reviewer's own claim as a report card: its scored cluster supplies score, statuses and the debate link.
function cardRow(finding, scored, auditor) {
  return {
    title: finding.title, severity: finding.severity, surface: finding.surface, status: scored?.status || '',
    finalStatus: scored?.finalStatus, debateClusterId: scored?.debateClusterId, clusterId: scored?.clusterId,
    score: scored?.score ?? '—', claimIds: [finding.claimId], auditors: [auditor], locations: finding.location,
    remediation: finding.fix, findings: [{ impact: finding.impact }],
    reviews: (scored?.reviews || []).filter((review) => review.claimId === finding.claimId),
  };
}

export function reviewerPageHtml(shell, v2, { reviewer, report, usage, scoredOf }) {
  const rows = report.findings.map((finding) => cardRow(finding, scoredOf(finding.claimId), finding.claimId.split('#')[0]));
  const claims = new Map(report.findings.map((finding) => [finding.claimId, finding]));
  const cards = rows.map((row, index) => findingCard(row, index, { originalClaims: claims, v2: v2?.card || null })).join('');
  const gaps = report.status === 'INCOMPLETE' ? `<div class="notice"><b>INCOMPLETE</b><span>${esc(report.gaps.map((gap) => `${gap.surface} ${gap.reason}`).join('; '))}</span></div>` : '';
  const body = `<header class="hero"><div><div class="eyebrow">Reviewer</div><h1>${esc(reviewer.id)}</h1><p>${reviewerBadge(reviewer)}</p><p class="note">${esc(usageLine(reviewer, usage))}</p></div></header>${gaps}
  <section id="findings" aria-label="Findings"><h2>Findings</h2>${findingsToolbar(severityCounts(rows))}
    <div id="findings-container">${cards}</div><div class="empty" id="empty-results" hidden>No findings match. Try another filter or search.</div></section>`;
  return shell.page(body, { root: '../../', here: 'reviewer', legacyStyle: false });
}

function reviewerCard(row) {
  const s = row.severity || {};
  const usage = { passes: row.passes, calls: row.calls, tokensIn: row.tokensIn, tokensOut: row.tokensOut, cost: row.cost, costSource: row.costSource, stops: row.stops };
  return `<article class="panel"><h3><a href="${esc(row.report)}">${esc(row.id)}</a></h3><p>${reviewerBadge(row)} ${esc(row.status)}</p><p>${usageStrip(usage)}</p><p>${(s.critical || 0) + (s.high || 0)} high · ${s.medium || 0} medium · ${(s.low || 0) + (s.info || 0)} low · ${esc(row.findings)} findings submitted · ${esc(row.uniqueFindings)} unique · ${esc(row.confirmed)} CONFIRMED · ${esc(row.refuted)} REFUTED</p></article>`;
}

export function indexPageHtml(shell, groups) {
  const sections = groups.map((group) => `<section data-family="${esc(group.family)}"><h2>${esc(group.label)}</h2>${group.vendors.flatMap((vendor) => vendor.reviewers.map((row) => reviewerCard({ ...row, family: group.family, vendor: vendor.vendor }))).join('')}</section>`).join('');
  const body = `<header class="hero"><div><div class="eyebrow">Reviewers</div><h1>Reviewers</h1><p>${esc(groups.map((group) => group.family).join(' → '))}</p></div></header>${sections || '<p class="notice"><b>INCOMPLETE</b> No reviewer reports were derived.</p>'}`;
  return shell.page(body, { modelPage: true, here: 'reviewers', legacyStyle: false });
}
