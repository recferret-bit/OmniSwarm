// Findings toolbar extras: layer chips (web2, web3, infra), final-status chips and a reviewer select. They combine with the severity buttons,
// surface tiles and search in report-cards-browser.mjs (one filter state).
import { esc } from './report-cards.mjs';
import { FINAL } from './report-section-status-legend.mjs';
import { LAYERS } from './harness-layers.mjs';

export const section = {
  id: 'finding-filters',
  order: 15,
  slot: 'toolbar',
  pages: ['report'],
  render({ people }) {
    const chips = FINAL.map((status) => `<button type="button" class="filter-btn" data-status-filter="${status}" aria-pressed="false">${esc(status)}</button>`).join('');
    const select = people.length ? `<label class="search-wrap">Reviewer<select data-reviewer-filter aria-label="Filter by reviewer"><option value="">All reviewers</option>${people.map((row) => `<option value="${esc(row.id)}">${esc(row.id)}</option>`).join('')}</select></label>` : '';
    const layers = LAYERS.map((layer) => `<button type="button" class="filter-btn" data-layer-filter="${layer}" aria-pressed="false">${esc(layer)}</button>`).join('');
    return `<div class="filter-group" role="group" aria-label="Filter by layer">${layers}</div><div class="filter-group" role="group" aria-label="Filter by final status">${chips}</div>${select}`;
  },
};
