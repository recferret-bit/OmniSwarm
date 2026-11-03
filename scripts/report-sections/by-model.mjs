// findings-by-model.html keyed by reviewer id, from reviewers/index.json. Counts are each reviewer's own
// submitted findings by severity (critical counts as high). Without an index the pre-v2 page is kept.
import { esc } from '../report-cards.mjs';
import { reviewerBadge, severityOf } from './reviewer-badge.mjs';

export const section = {
  id: 'by-model',
  order: 30,
  slot: 'page',
  pages: ['by-model'],
  render({ people }) {
    if (!people.length) return null;
    const rows = people.map((row) => ({ row, s: severityOf(row) })).map(({ row, s }) => ({ row, s, total: s.high + s.medium + s.low }));
    const max = Math.max(1, ...rows.map((r) => r.total));
    const bars = rows.map(({ row, total }) => `<div class="chart-row"><div class="chart-name">${esc(row.id)}<div class="note">${reviewerBadge(row)}</div></div><div class="chart-track" aria-hidden="true"><div class="chart-fill" style="width:${((total / max) * 100).toFixed(2)}%"></div></div><div class="chart-total">${total}</div></div>`).join('');
    const table = rows.map(({ row, s, total }) => `<tr><th scope="row">${esc(row.id)}</th><td>${reviewerBadge(row)}</td><td>${s.high}</td><td>${s.medium}</td><td>${s.low}</td><td>${total}</td><td>${esc(row.status || 'unknown')}</td></tr>`).join('');
    const body = `<header class="hero"><div><div class="eyebrow">Reviewer output / 03</div><h1>MODEL <span>REPORT.</span></h1></div></header><section class="panel" aria-label="Findings by reviewer">${bars}</section><section class="panel"><h2>Severity breakdown</h2><table><thead><tr><th>Reviewer</th><th>Family</th><th>High</th><th>Medium</th><th>Low</th><th>Total</th><th>Validation</th></tr></thead><tbody>${table}</tbody></table></section>`;
    return { rel: 'findings-by-model.html', body, opts: { modelPage: true } };
  },
};
