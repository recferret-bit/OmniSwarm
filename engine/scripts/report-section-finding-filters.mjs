// Findings toolbar extras: final-status chips and a reviewer select. They combine with the severity buttons,
// surface tiles and search in report-cards-browser.mjs (one filter state).
import { esc } from './report-cards.mjs';
import { FINAL } from './report-section-status-legend.mjs';

export const section = {
  id: 'finding-filters',
  order: 15,
  slot: 'toolbar',
  pages: ['report'],
  render({ people }) {
    const chips = FINAL.map((status) => `<button type="button" class="filter-btn" data-status-filter="${status}" aria-pressed="false">${esc(status)}</button>`).join('');
    const select = people.length ? `<label class="search-wrap">Reviewer<select data-reviewer-filter aria-label="Filter by reviewer"><option value="">All reviewers</option>${people.map((row) => `<option value="${esc(row.id)}">${esc(row.id)}</option>`).join('')}</select></label>` : '';
    return `<div class="filter-group" role="group" aria-label="Filter by final status">${chips}</div>${select}`;
  },
};
