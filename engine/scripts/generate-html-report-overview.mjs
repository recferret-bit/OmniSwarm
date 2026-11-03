// report.html above the evidence: hero, notice, finding totals, the surface map and the findings list.
import { esc, findingCard, findingsToolbar } from './report-cards.mjs';
import { SURFACE_NAMES } from './generate-html-report-context.mjs';
import { incompleteLabelOf } from './generate-html-report-evidence.mjs';

const SHORT_SURFACE = { S1: 'Identity & access', S2: 'Input & injection', S3: 'Logic & value', S4: 'Secrets & config', S5: 'Dependencies', S6: 'Client & web' };

export const sectionTitle = (id, title, side = '') => `<div class="section-heading"><h2><span class="section-num">${id}</span>${title}</h2>${side ? `<span class="meta-label">${esc(side)}</span>` : ''}</div>`;

export function hero({ targetName, meta, accepted, expected, complete, reviewComplete }, modelPage = false) {
  const statusLabel = complete ? 'Outputs validated' : reviewComplete ? 'Verification incomplete' : 'Incomplete review';
  return `<header class="hero"><div><div class="eyebrow">${modelPage ? 'Reviewer output / 03' : 'Source assessment / 01'}</div><h1>${modelPage ? 'MODEL <span>REPORT.</span>' : 'AUDIT <span>REPORT.</span>'}</h1><p class="target">${esc(targetName)}</p><div class="source">${esc([meta.mode === 'remote' ? 'GITHUB' : 'SOURCE', meta.commit && `REF ${meta.commit}`, meta.surface && `SCOPE ${meta.surface}`].filter(Boolean).join(' / '))}</div></div>
    <div class="hero-status"><span class="eyebrow">${statusLabel}</span><strong>${accepted} / ${expected} assignments</strong><p>${reviewComplete ? 'Review outputs accepted. Claims remain unverified.' : 'Review coverage gaps remain. See evidence & scope.'}</p><div class="progress" aria-hidden="true">${Array.from({ length: expected }, (_, i) => `<i${i < accepted ? ' class="done"' : ''}></i>`).join('')}</div></div></header>`;
}

export function notice(ctx) {
  const { complete, reviewComplete } = ctx;
  return `<div class="notice"><b>${complete ? 'UNVERIFIED CLAIMS' : incompleteLabelOf(ctx)}</b><span>Model assertions, not a safety certificate. ${complete ? 'Zero findings does not prove safety.' : reviewComplete ? 'Review outputs are complete; required execution coverage still has gaps.' : 'Missing reviews are not passes.'}</span><a href="report.html#validation">View limitations ↗</a></div>`;
}

function stats({ counts }) {
  return `<section class="stats" aria-label="Finding totals">
    ${[
    ['red', 'High severity', counts.high, 'Critical + high model claims', '01'],
    ['orange', 'Medium severity', counts.medium, 'Medium model claims', '02'],
    ['blue', 'Low + info', counts.low + counts.info, 'Lower severity model claims', '03'],
    ['green', 'Model agreement', counts.modelAgreement, 'Matching claims · unverified', '04'],
  ].map(([tone, label, number, detail, index]) => `<div class="stat ${tone}"><div class="stat-label">${label}<span>${index}</span></div><div class="stat-number">${number}</div><small>${detail}</small></div>`).join('')}
  </section>`;
}

function surfaceTile(id, label, { surfaces, health }) {
  const s = surfaces[id];
  const assignments = (health.expected || []).filter((name) => String(name).includes(`-${id.toLowerCase()}-`));
  const valid = assignments.filter((name) => (health.accepted || []).includes(name)).length;
  const missing = assignments.length > valid;
  const coverage = !assignments.length ? 'Outside scope' : missing ? 'Review incomplete' : 'Outputs received';
  return `<button type="button" class="surface" data-surface-filter="${id}" aria-pressed="false" aria-label="Filter ${id}: ${esc(label)}, ${s.total} findings. ${coverage}"><div><div class="surface-code">${id} / ${String(Object.keys(SURFACE_NAMES).indexOf(id) + 1).padStart(2, '0')}</div><div class="surface-name">${esc(SHORT_SURFACE[id])}</div></div><span class="surface-total">${s.total}</span><div class="surface-bottom">${s.total ? `<span><span class="red">${s.high}H</span> / <span class="orange">${s.medium}M</span> / <span class="blue">${s.low + s.info}L</span></span>` : '<span class="no-claims">No claims</span>'}<span class="${missing ? 'coverage-gap' : 'no-claims'}">${!assignments.length ? 'Out of scope' : missing ? 'Incomplete' : `${valid}/${assignments.length} received`}</span></div></button>`;
}

export function overviewSections(ctx, v2) {
  const { counts, findings, originalClaims } = ctx;
  const cards = findings.map((f, i) => findingCard(f, i, { originalClaims, v2: v2?.card || null })).join('');
  return `${stats(ctx)}
  <section aria-labelledby="surface-heading">${sectionTitle('01', '<span id="surface-heading">Surface map</span>', 'Select a surface to filter')}<div class="surface-grid">
    ${Object.entries(SURFACE_NAMES).map(([id, label]) => surfaceTile(id, label, ctx)).join('')}
  </div></section>
  <section id="findings" aria-label="Findings">${sectionTitle('02', 'Findings', `${counts.total} prioritized model claims`)}
    ${findingsToolbar(counts, v2 ? v2.slot('toolbar') : '')}
    <div id="findings-container">${cards}</div><div class="empty" id="empty-results" hidden>No findings match. Try another filter or search.</div>
  </section>`;
}
