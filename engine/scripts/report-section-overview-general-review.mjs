// Overview hero: risk posture, three summary lines and the top five findings, linked to their cards by the
// debate cluster id the card carries (joined by claim id in verify-and-adjudicate-debate.mjs).
import { esc } from './report-cards.mjs';
import { DISCLAIMER } from './debate-general-review.mjs';
import { statusPill } from './report-section-status-legend.mjs';

export const section = {
  id: 'overview-general-review',
  order: 5,
  slot: 'hero',
  pages: ['report'],
  render({ general }) {
    if (!general) return '<div class="notice"><b>INCOMPLETE</b><span>General review not run — report INCOMPLETE</span></div>';
    const summary = String(general.executiveSummary || '').split('\n').slice(0, 3).join(' ');
    const top = (general.topFindings || []).slice(0, 5).map((row) => `<li><a href="#finding-${esc(row.clusterId)}">${esc(row.title)}</a> ${statusPill(row.finalStatus)}</li>`).join('');
    return `<section id="general-review-hero" aria-label="General review"><p class="eyebrow">General review</p><p>${statusPill(general.riskPosture)}</p><p>${esc(summary)}</p><ul>${top}</ul><p>${esc(general.disclaimer || DISCLAIMER)}</p></section>`;
  },
};
