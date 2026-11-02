// Report v2 sections. A run without debate/ or general-review.json gets an empty add-on,
// so the pre-v2 pages stay byte-for-byte the same.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { section as byModel } from './by-model.mjs';
import { section as crosscheck } from './crosscheck.mjs';
import { section as findingDebate } from './finding-debate.mjs';
import { section as generalReview } from './general-review.mjs';
import { section as overviewHero } from './overview-general-review.mjs';
import { section as reviewersIndex } from './reviewers-index.mjs';
import { section as statusLegend } from './status-legend.mjs';

const FINAL = ['AGREED', 'CONFIRMED', 'LIKELY', 'DISPUTED', 'REFUTED', 'INSUFFICIENT_EVIDENCE'];
const LEGACY = ['MODEL_AGREEMENT', 'MODEL_ASSERTION', 'REFUTED_REVIEW', 'UNVERIFIED', 'INCOMPLETE'];
const MEANING = {
  AGREED: 'Two vendors cited the same lines before debate.',
  CONFIRMED: 'The judge upheld the finding from verified quotes.',
  LIKELY: 'A single source remains, and no valid citation refuted it.',
  DISPUTED: 'Verified arguments disagree.',
  REFUTED: 'A verified citation refuted the finding.',
  INSUFFICIENT_EVIDENCE: 'No verified citation decided the cluster.',
  MODEL_AGREEMENT: 'Two vendors asserted the same claim.',
  MODEL_ASSERTION: 'One vendor asserted the claim.',
  REFUTED_REVIEW: 'A peer review refuted the claim.',
  UNVERIFIED: 'The claim was not cross-checked.',
  INCOMPLETE: 'A required output is missing.',
};
const ORDER = ['cli', 'key', 'openrouter', 'scripted', 'nearai'];
const TONE = {
  AGREED: 'green', CONFIRMED: 'green', LIKELY: 'blue', DISPUTED: 'orange', REFUTED: 'red', INSUFFICIENT_EVIDENCE: 'orange',
  MODEL_AGREEMENT: 'green', MODEL_ASSERTION: 'blue', REFUTED_REVIEW: 'red', UNVERIFIED: 'orange', INCOMPLETE: 'orange',
};
// Foreground on white. The accessibility test fails a token that drops under 4.5:1.
export const STATUS_COLORS = {
  AGREED: { fg: '#0d5c3d', bg: '#ffffff' },
  CONFIRMED: { fg: '#0d5c3d', bg: '#ffffff' },
  LIKELY: { fg: '#1a3f9a', bg: '#ffffff' },
  DISPUTED: { fg: '#8a3b00', bg: '#ffffff' },
  REFUTED: { fg: '#9d1c2e', bg: '#ffffff' },
  INSUFFICIENT_EVIDENCE: { fg: '#8a3b00', bg: '#ffffff' },
  MODEL_AGREEMENT: { fg: '#0d5c3d', bg: '#ffffff' },
  MODEL_ASSERTION: { fg: '#1a3f9a', bg: '#ffffff' },
  REFUTED_REVIEW: { fg: '#9d1c2e', bg: '#ffffff' },
  UNVERIFIED: { fg: '#8a3b00', bg: '#ffffff' },
  INCOMPLETE: { fg: '#8a3b00', bg: '#ffffff' },
};
const DISCLAIMER = 'Model agreement and passing checks do not certify security.';
const SECTIONS = [overviewHero, statusLegend, findingDebate, byModel, crosscheck, generalReview, reviewersIndex];

export function loadSections(dir = path.dirname(fileURLToPath(import.meta.url))) {
  return fs.readdirSync(dir).filter((name) => name.endsWith('.mjs') && name !== 'registry.mjs').sort();
}

export function sectionDescriptors() {
  return [...SECTIONS].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function read(dir, rel) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')); } catch { return null; }
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

function pill(esc, status) {
  const tone = TONE[status] || '';
  return `<span class="pill${tone ? ` ${tone}` : ''}" data-status="${esc(status)}">${esc(status)}</span>`;
}

export function statusCss() {
  return Object.entries(STATUS_COLORS).map(([status, color]) => `.pill[data-status="${status}"]{color:${color.fg};background:${color.bg}}`).join('');
}

function safeMarkdown(esc, markdown) {
  const source = String(markdown || '');
  const parts = source.split(/(```[\s\S]*?```)/g).map((part) => {
    if (part.startsWith('```')) {
      const code = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
      return `<pre><code>${esc(code)}</code></pre>`;
    }
    return part.split(/\n\s*\n/).filter((block) => block.trim()).map((block) => {
      const lines = block.split('\n');
      if (lines.every((line) => /^\s*\|.*\|\s*$/.test(line))) {
        const rows = lines.filter((line) => !/^\s*\|?\s*-+/.test(line));
        return `<table>${rows.map((line) => `<tr>${line.split('|').slice(1, -1).map((cell) => `<td>${esc(cell.trim())}</td>`).join('')}</tr>`).join('')}</table>`;
      }
      if (lines.every((line) => /^\s*[-*] /.test(line))) return `<ul>${lines.map((line) => `<li>${esc(line.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
      if (lines.every((line) => /^#{1,3} /.test(line))) {
        return lines.map((line) => {
          const level = Math.min(line.match(/^#+/)[0].length + 2, 4);
          return `<h${level}>${esc(line.replace(/^#+\s+/, ''))}</h${level}>`;
        }).join('');
      }
      const linked = esc(block).replace(/\[([^\]]+)\]\(#([a-z0-9-]+)\)/gi, '<a href="#$2">$1</a>');
      return `<p>${linked}</p>`;
    }).join('');
  });
  return parts.join('');
}

function citationState(citations, turn, citation) {
  const hit = citations.find((row) => row.file === citation.file && row.startLine === citation.startLine && row.quote === citation.quote && (row.clusterId == null || row.clusterId === turn.clusterId));
  const valid = citation.valid !== false && hit?.valid !== false;
  return { valid, reason: citation.reason || hit?.reason || 'quote_not_found' };
}

function reviewersFromIndex(index) {
  const groups = [...(index?.groups || [])].sort((a, b) => {
    const ia = ORDER.indexOf(a.family);
    const ib = ORDER.indexOf(b.family);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return groups.flatMap((group) => (group.vendors || []).flatMap((vendor) => (vendor.reviewers || []).map((row) => ({ ...row, family: group.family, vendor: vendor.vendor }))));
}

function loadUsage(reportDir, id, row) {
  const usage = read(reportDir, `reviewers/${id}/usage.json`);
  const totals = usage?.totals || {};
  const passes = Array.isArray(usage?.passes) ? usage.passes : [];
  const cost = row.cost !== undefined ? row.cost : (totals.cost !== undefined ? totals.cost : null);
  return {
    passes: passes.length || row.passes || 0,
    calls: totals.calls ?? row.calls ?? null,
    tokensIn: totals.tokensIn ?? row.tokensIn ?? null,
    tokensOut: totals.tokensOut ?? row.tokensOut ?? null,
    cost,
    stops: totals.stops || row.stops || passes.map((pass) => pass.stop).filter(Boolean),
  };
}

function money(cost) {
  return cost == null ? '—' : cost;
}

export function v2Extras(reportDir, esc) {
  const clustersFile = read(reportDir, 'debate/clusters.json');
  const general = read(reportDir, 'general-review.json');
  const active = Boolean(clustersFile || general);
  const empty = { active: false, rail: '', hero: '', sections: '', extraCss: '', script: '', reviewerFilter: '', debateHtml: () => '', writePages: null };
  if (!active) return empty;
  const clusters = clustersFile?.clusters || (Array.isArray(clustersFile) ? clustersFile : []);
  const gaps = [
    ...(clustersFile?.coverageGaps || []),
    ...clusters.filter((cluster) => cluster.status === 'CAPPED').map((cluster) => ({ clusterId: cluster.id, reason: 'debate_cap' })),
  ];
  const seenGaps = new Set();
  const coverageGaps = gaps.filter((gap) => {
    const key = `${gap.clusterId}:${gap.reason}`;
    if (seenGaps.has(key)) return false;
    seenGaps.add(key);
    return true;
  });
  const adjudication = read(reportDir, 'debate/adjudication.json') || [];
  const byCluster = new Map((Array.isArray(adjudication) ? adjudication : []).map((row) => [row.clusterId, row]));
  const rounds = [1, 2, 3].flatMap((n) => listJson(path.join(reportDir, 'debate', `round-${n}`)));
  const citations = read(reportDir, 'debate/citations.json') || [];
  const index = read(reportDir, 'reviewers/index.json');
  const people = reviewersFromIndex(index);

  const hero = general
    ? `<section id="general-review-hero" aria-label="General review"><p class="eyebrow">General review</p><p>${pill(esc, general.riskPosture)}</p><p>${esc(String(general.executiveSummary || '').split('\n').slice(0, 3).join(' '))}</p><ul>${(general.topFindings || []).slice(0, 5).map((row) => `<li><a href="#finding-${esc(row.clusterId)}">${esc(row.title)}</a> ${pill(esc, row.finalStatus)}</li>`).join('')}</ul><p>${esc(general.disclaimer || DISCLAIMER)}</p></section>`
    : '<div class="notice"><b>INCOMPLETE</b><span>General review not run — report INCOMPLETE</span></div>';
  const legend = `<section id="status-legend" aria-label="Status legend"><h2>Status legend</h2><ul>${[...FINAL, ...LEGACY].map((status) => `<li>${pill(esc, status)} ${esc(MEANING[status])}</li>`).join('')}</ul></section>`;

  const statusOf = (cluster) => {
    if (cluster.status === 'AGREED' || cluster.status === 'CAPPED') return cluster.status;
    return byCluster.get(cluster.id)?.finalStatus || cluster.status || '';
  };
  const roundsOf = (cluster) => {
    if (cluster.status === 'AGREED' || cluster.rounds === 0) return 0;
    if (Number.isFinite(cluster.rounds)) return cluster.rounds;
    return rounds.filter((turn) => turn.clusterId === cluster.id).reduce((n, turn) => Math.max(n, turn.round || 0), 0);
  };
  const rows = clusters.map((cluster) => {
    const judged = byCluster.get(cluster.id) || {};
    const related = rounds.filter((turn) => turn.clusterId === cluster.id);
    let valid = 0;
    let discarded = 0;
    for (const turn of related) {
      for (const citation of turn.citations || []) {
        if (citationState(citations, turn, citation).valid) valid += 1;
        else discarded += 1;
      }
    }
    const status = statusOf(cluster);
    const roundCount = roundsOf(cluster);
    return `<tr data-status="${esc(status)}"><td>${esc(cluster.primaryTitle || cluster.id)}</td><td>${pill(esc, status)}</td><td>${roundCount} rounds</td><td>${esc(judged.judge?.vendor || '')}</td><td>${judged.judge?.alternate ? 'yes' : 'no'}</td><td>${valid}</td><td>${discarded}</td></tr>`;
  }).join('');
  const filters = FINAL.map((status) => `<button type="button" class="filter-btn" data-cross-filter="${status}" aria-pressed="false">${esc(status)}</button>`).join('');
  const cross = `<section id="crosscheck" aria-label="Cross-check"><h2><span>05</span> Cross-check</h2><div class="filter-group" role="group" aria-label="Filter clusters by status">${filters}</div><table><thead><tr><th>Cluster</th><th>Status</th><th>Rounds</th><th>Judge vendor</th><th>Alternate</th><th>Valid</th><th>Discarded</th></tr></thead><tbody>${rows}</tbody></table><h3>Not debated (cap)</h3><ul>${coverageGaps.map((gap) => `<li>${esc(gap.clusterId)} ${esc(gap.reason || 'debate_cap')}</li>`).join('')}</ul></section>`;
  const markdown = fs.existsSync(path.join(reportDir, 'general-review.md')) ? fs.readFileSync(path.join(reportDir, 'general-review.md'), 'utf8') : '';
  const contrib = (general?.contributions || []).map((row) => `<tr><td>${esc(row.reviewerId)}</td><td>${esc(row.uniqueConfirmed)}</td><td>${esc(row.refuted)}</td><td>${esc(row.toolCalls)}</td><td>${row.costUsd == null ? '—' : esc(row.costUsd)}</td></tr>`).join('');
  const method = general?.methodology
    ? `<p>Reviewers ${esc((general.methodology.reviewers || []).join(', '))}. Orchestrator ${esc(general.methodology.orchestrator)}. Passes ${esc(general.methodology.passes)}. Tool budget ${esc(general.methodology.toolBudget)}. Debate rounds ${esc(general.methodology.debateRounds)}.</p>`
    : '';
  const disagreements = (general?.openDisagreements || []).map((row) => `<li>${esc(row.clusterId)}: ${esc(row.summary)}</li>`).join('');
  const coverage = (general?.coverage || []).map((row) => `<tr><td>${esc(row.surface)}</td><td>${row.covered ? 'yes' : 'no'}</td><td>${esc((row.gaps || []).join(', '))}</td></tr>`).join('');
  const review = `<section id="general-review" aria-label="General review"><h2><span>06</span> General review</h2><div class="prose">${safeMarkdown(esc, markdown)}</div><h3>Coverage and gaps</h3><table><thead><tr><th>Surface</th><th>Covered</th><th>Gaps</th></tr></thead><tbody>${coverage}</tbody></table>${disagreements ? `<h3>Open disagreements</h3><ul>${disagreements}</ul>` : ''}${method}<h3>Contributions</h3><table><thead><tr><th>Reviewer</th><th>Confirmed</th><th>Refuted</th><th>Calls</th><th>Cost</th></tr></thead><tbody>${contrib}</tbody></table><p>${esc(general?.disclaimer || DISCLAIMER)}</p></section>`;

  const debateHtml = (finding) => {
    const id = finding.clusterId || finding.id;
    const cluster = clusters.find((row) => row.id === id) || clusters.find((row) => row.primaryTitle && row.primaryTitle === finding.title);
    const clusterId = cluster?.id || id;
    const related = rounds.filter((turn) => turn.clusterId === clusterId).sort((a, b) => a.round - b.round || String(a.anonId).localeCompare(String(b.anonId)));
    if (!related.length) return '';
    const judged = byCluster.get(clusterId);
    const args = related.map((turn) => {
      const chips = (turn.citations || []).map((citation) => {
        const state = citationState(citations, turn, citation);
        const mark = state.valid ? '✓' : `✗ ${state.reason}`;
        return `<code class="citation-chip">${esc(citation.file)}:${esc(citation.startLine)} ${mark}</code>`;
      }).join(' ');
      return `<p><b>${esc(turn.anonId)}</b> round ${esc(turn.round)} ${esc(turn.verdict)} ${turn.devilAdvocate ? '<span class="pill">devil\'s advocate</span>' : ''} ${turn.conformitySuspect ? '<span class="pill">conformity suspect</span>' : ''}</p><p>${esc(turn.argument)}</p>${chips}`;
    }).join('');
    return `<details class="disclosure debate" aria-expanded="false"><summary>Debate</summary><div>${args}<p>${esc(judged?.rationale || '')}</p>${judged?.severityReason ? `<p>${esc(judged.severityReason)}</p>` : ''}${judged?.finalStatus ? pill(esc, judged.finalStatus) : ''}</div></details>`;
  };

  const rail = (root = '', here = 'report') => {
    const report = here === 'report' ? '' : `${root}report.html`;
    const links = sectionDescriptors().filter((item) => item.rail && (item.id === 'crosscheck' || item.id === 'general-review' || item.id === 'reviewers-index'));
    return links.map((item) => {
      if (item.id === 'reviewers-index') return `<a href="${root}reviewers.html"><span>${item.rail.num}</span>${item.rail.label}</a>`;
      const href = item.id === 'crosscheck' ? `${report}#crosscheck` : `${report}#general-review`;
      return `<a href="${href}"><span>${item.rail.num}</span>${item.rail.label}</a>`;
    }).join('');
  };

  const script = `const crossButtons=[...document.querySelectorAll('[data-cross-filter]')];crossButtons.forEach((button)=>button.addEventListener('click',()=>{const on=button.getAttribute('aria-pressed')!=='true';crossButtons.forEach((item)=>item.setAttribute('aria-pressed','false'));if(on)button.setAttribute('aria-pressed','true');const status=on?button.getAttribute('data-cross-filter'):'';document.querySelectorAll('#crosscheck tbody tr').forEach((row)=>{row.hidden=Boolean(status)&&row.getAttribute('data-status')!==status;});}));const reviewerSelect=document.querySelector('[data-reviewer-filter]');if(reviewerSelect){reviewerSelect.addEventListener('change',()=>{const id=reviewerSelect.value;document.querySelectorAll('.finding').forEach((card)=>{const ids=(card.getAttribute('data-reviewers')||'').split(/\\s+/).filter(Boolean);card.hidden=Boolean(id)&&!ids.some((name)=>name===id||name.startsWith(id+'-'));});});}`;

  const reviewerFilter = people.length
    ? `<label class="search-wrap">Reviewer<select data-reviewer-filter aria-label="Filter by reviewer"><option value="">All reviewers</option>${people.map((row) => `<option value="${esc(row.id)}">${esc(row.id)}</option>`).join('')}</select></label>`
    : '';

  return {
    active: true,
    rail,
    hero: `${hero}${legend}`,
    sections: `${cross}${review}`,
    extraCss: statusCss(),
    script,
    reviewerFilter,
    debateHtml,
    writePages(reportDirArg, render, findings = []) {
      const groups = [...(index?.groups || [])].sort((a, b) => ORDER.indexOf(a.family) - ORDER.indexOf(b.family));
      const cards = groups.map((group) => {
        const body = (group.vendors || []).map((vendor) => (vendor.reviewers || []).map((row) => {
          const usage = loadUsage(reportDirArg, row.id, row);
          const badge = `${group.family} · ${vendor.vendor}${row.model ? ` · ${row.model}` : ''}`;
          return `<article class="panel"><h3><span class="pill" aria-label="${esc(badge)}">${esc(group.family)} · ${esc(vendor.vendor)}</span></h3><p><a href="${esc(row.report || `reviewers/${row.id}/report.html`)}">${esc(row.id)}</a></p><p>${esc(usage.passes)} passes · ${usage.calls == null ? '—' : esc(usage.calls)} calls · tokens ${usage.tokensIn == null ? '—' : esc(usage.tokensIn)}/${usage.tokensOut == null ? '—' : esc(usage.tokensOut)} · cost ${money(usage.cost)} · stops ${esc((usage.stops || []).join(', ') || '—')}</p><p>${esc(row.uniqueFindings ?? 0)} findings submitted · ${esc(row.uniqueConfirmed ?? 0)} CONFIRMED · ${esc(row.refuted ?? 0)} REFUTED</p></article>`;
        }).join('')).join('');
        return `<section data-family="${esc(group.family)}"><h2>${esc(group.family)}</h2>${body}</section>`;
      }).join('');
      const grouped = groups.map((group) => group.family).join(' → ');
      render('reviewers.html', `<p class="eyebrow">Reviewers</p><h1>Reviewers</h1><p>${esc(grouped)}</p>${cards || '<p class="notice"><b>INCOMPLETE</b> reviewers/index.json is missing.</p>'}`, { modelPage: true });
      for (const row of people) {
        const mine = findings.filter((finding) => (finding.auditors || []).some((name) => name === row.id || String(name).startsWith(`${row.id}-`)));
        const usage = loadUsage(reportDirArg, row.id, row);
        const badge = `${row.family} · ${row.vendor}`;
        const body = `<header class="hero"><div><div class="eyebrow">Reviewer</div><h1>${esc(row.id)}</h1><p><span class="pill" aria-label="${esc(badge)}">${esc(badge)}</span></p><p>${esc(usage.passes)} passes · ${usage.calls == null ? '—' : esc(usage.calls)} calls · cost ${money(usage.cost)}</p></div></header><h2>Findings</h2><div class="toolbar"><div class="filter-group" role="group" aria-label="Filter by severity"><button type="button" class="filter-btn active" data-filter="all" aria-pressed="true">All</button><button type="button" class="filter-btn" data-filter="high" aria-pressed="false">High+</button><button type="button" class="filter-btn" data-filter="medium" aria-pressed="false">Medium</button><button type="button" class="filter-btn" data-filter="low" aria-pressed="false">Low + info</button></div><label class="search-wrap"><input type="search" id="search-box" aria-label="Search findings"></label></div><div class="list-caption"><span id="results-count" role="status"></span><button type="button" id="reset-filters" class="text-button" hidden>Clear filters</button><button type="button" id="expand-all" class="text-button">Expand findings</button></div><div id="findings-container">${mine.map((finding, i) => render.card(finding, i)).join('')}</div><div class="empty" id="empty-results" hidden>No findings match.</div>`;
        render(`reviewers/${row.id}/report.html`, body, { root: '../../', here: 'reviewer' });
      }
      const max = Math.max(1, ...people.map((row) => row.uniqueFindings || 0));
      const bars = people.map((row) => {
        const width = ((row.uniqueFindings || 0) / max) * 100;
        const badge = `${row.family} · ${row.vendor}`;
        return `<div class="chart-row"><div class="chart-name">${esc(row.id)}<div class="note"><span class="pill" aria-label="${esc(badge)}">${esc(badge)}</span></div></div><div class="chart-track" aria-hidden="true"><div class="chart-fill" style="width:${width.toFixed(2)}%"></div></div><div class="chart-total">${esc(row.uniqueFindings ?? 0)}</div></div>`;
      }).join('');
      const table = people.map((row) => `<tr><th scope="row">${esc(row.id)}</th><td><span class="pill" aria-label="${esc(`${row.family} · ${row.vendor}`)}">${esc(row.family)} · ${esc(row.vendor)}</span></td><td>${esc(row.severity?.high ?? row.uniqueFindings ?? 0)}</td><td>${esc(row.severity?.medium ?? 0)}</td><td>${esc(row.severity?.low ?? 0)}</td><td>${esc(row.uniqueFindings ?? 0)}</td></tr>`).join('');
      render('findings-by-model.html', `<header class="hero"><div><div class="eyebrow">Reviewer output / 03</div><h1>MODEL <span>REPORT.</span></h1></div></header><section class="panel" aria-label="Findings by reviewer">${bars}</section><section class="panel"><h2>Severity breakdown</h2><table><thead><tr><th>Reviewer</th><th>Family</th><th>High</th><th>Medium</th><th>Low</th><th>Total</th></tr></thead><tbody>${table}</tbody></table></section>`, { modelPage: true });
    },
  };
}

export const STATUS_LEGEND = { FINAL, LEGACY, MEANING, ORDER };
