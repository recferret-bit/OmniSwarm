// Reviewer badge and usage strip, shared by findings-by-model, reviewers.html and the per-reviewer pages.
// Not a section (exports no `section`). An unknown cost shows as —, never as $0.
import { esc } from '../report-cards.mjs';

function badgeText(row) {
  return [row.family, row.vendor, row.model].filter(Boolean).join(' · ');
}

export function reviewerBadge(row) {
  return `<span class="pill" aria-label="${esc(badgeText(row))}">${esc(badgeText(row))}</span>`;
}

export function money(cost, costSource) {
  return cost == null || costSource === 'none' ? '—' : `$${Number(cost).toFixed(2)}`;
}

// usage: {passes, calls, tokensIn, tokensOut, cost, costSource, stops}; null fields render as —.
export function usageStrip(usage) {
  const n = (value) => (value == null ? '—' : esc(value));
  return `${n(usage.passes)} passes · ${n(usage.calls)} calls · tokens ${n(usage.tokensIn)}/${n(usage.tokensOut)} · cost ${money(usage.cost, usage.costSource)} · stops ${esc((usage.stops || []).join(', ') || '—')}`;
}

export function severityOf(row) {
  const s = row.severity || {};
  return { high: (s.critical || 0) + (s.high || 0), medium: s.medium || 0, low: (s.low || 0) + (s.info || 0) };
}
