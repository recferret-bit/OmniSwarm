// Status tokens: six final statuses from the debate (AGREED is the triage shortcut) and the five peer-review
// statuses verify-and-adjudicate.mjs emits. Foreground on white; the a11y test fails a token under 4.5:1.
import { esc } from '../report-cards.mjs';

export const FINAL = ['AGREED', 'CONFIRMED', 'LIKELY', 'DISPUTED', 'REFUTED', 'INSUFFICIENT_EVIDENCE'];
export const LEGACY = ['MODEL_AGREEMENT', 'MODEL_ASSERTION', 'UPHELD_REVIEW', 'PARTIAL_REVIEW', 'REFUTED_REVIEW'];
export const MEANING = {
  AGREED: 'Two vendors cited the same lines before debate.',
  CONFIRMED: 'An independent reviewer upheld the finding with a verified quote.',
  LIKELY: 'A single source remains, and no valid citation refuted it.',
  DISPUTED: 'Verified arguments disagree, or no judge of another vendor was available.',
  REFUTED: 'A verified citation refuted the finding.',
  INSUFFICIENT_EVIDENCE: 'No verified citation decided the cluster.',
  MODEL_AGREEMENT: 'Two vendors asserted the same claim.',
  MODEL_ASSERTION: 'One vendor asserted the claim.',
  UPHELD_REVIEW: 'A peer of another vendor upheld the claim.',
  PARTIAL_REVIEW: 'Peers of another vendor disagreed, or upheld it only in part.',
  REFUTED_REVIEW: 'A peer of another vendor refuted the claim.',
};
const TONE = {
  AGREED: 'green', CONFIRMED: 'green', LIKELY: 'blue', DISPUTED: 'orange', REFUTED: 'red', INSUFFICIENT_EVIDENCE: 'orange',
  MODEL_AGREEMENT: 'green', MODEL_ASSERTION: 'blue', UPHELD_REVIEW: 'green', PARTIAL_REVIEW: 'orange', REFUTED_REVIEW: 'red',
};
const FG = { green: '#0d5c3d', blue: '#1a3f9a', orange: '#8a3b00', red: '#9d1c2e' };
export const STATUS_COLORS = Object.fromEntries(Object.entries(TONE).map(([status, tone]) => [status, { fg: FG[tone], bg: '#ffffff' }]));

export function statusPill(status) {
  const tone = TONE[status] || '';
  return `<span class="pill${tone ? ` ${tone}` : ''}" data-status="${esc(status)}">${esc(status)}</span>`;
}

// Orange pills take --orange-ink from report-style.css on every page; status pills set their own colours here.
export function statusCss() {
  return Object.entries(STATUS_COLORS).map(([status, color]) => `.pill[data-status="${status}"]{color:${color.fg};background:${color.bg}}`).join('');
}

export const section = {
  id: 'status-legend',
  order: 10,
  slot: 'hero',
  pages: ['report'],
  render() {
    return `<section id="status-legend" aria-label="Status legend"><h2>Status legend</h2><ul>${[...FINAL, ...LEGACY].map((status) => `<li>${statusPill(status)} ${esc(MEANING[status])}</li>`).join('')}</ul></section>`;
  },
};
