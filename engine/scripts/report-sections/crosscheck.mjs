// Rail 05: one row per debate cluster (AGREED clusters show 0 rounds), the judge and whether it was the
// alternate, verified and discarded citations, conformity-suspect turns, and the clusters the cap left out.
import { esc } from '../report-cards.mjs';
import { FINAL, statusPill } from './status-legend.mjs';
import { citationState, turnsOf } from './v2-data.mjs';

const statusOf = (data, cluster) => (cluster.status === 'AGREED' || cluster.status === 'CAPPED' ? cluster.status : data.byCluster.get(cluster.id)?.finalStatus || cluster.status || '');
const roundsOf = (cluster, turns) => (cluster.status === 'AGREED' || cluster.rounds === 0 ? 0 : Number.isFinite(cluster.rounds) ? cluster.rounds : turns.reduce((n, t) => Math.max(n, t.round || 0), 0));

function row(data, cluster) {
  const turns = turnsOf(data, cluster.id);
  const checked = turns.flatMap((turn) => (turn.citations || []).map((citation) => citationState(data, turn, citation)));
  const judged = data.byCluster.get(cluster.id) || {};
  const status = statusOf(data, cluster);
  return `<tr data-status="${esc(status)}"><td>${esc(cluster.primaryTitle || cluster.id)}</td><td>${statusPill(status)}</td><td>${roundsOf(cluster, turns)} rounds</td><td>${esc(judged.judge?.vendor || '—')}</td><td>${judged.judge?.alternate ? 'yes' : 'no'}</td><td>${checked.filter((c) => c.valid).length}</td><td>${checked.filter((c) => !c.valid).length}</td><td>${turns.filter((t) => t.conformitySuspect).length}</td></tr>`;
}

export const section = {
  id: 'crosscheck',
  order: 50,
  slot: 'evidence',
  rail: { num: '05', label: 'Cross-check', anchor: 'crosscheck' },
  pages: ['report'],
  render(data) {
    const filters = FINAL.map((status) => `<button type="button" class="filter-btn" data-cross-filter="${status}" aria-pressed="false">${esc(status)}</button>`).join('');
    const gaps = data.coverageGaps.map((gap) => `<li>${esc(gap.clusterId)} ${esc(gap.reason || 'debate_cap')}</li>`).join('');
    return `<section id="crosscheck" aria-label="Cross-check"><h2><span>05</span> Cross-check</h2><div class="filter-group" role="group" aria-label="Filter clusters by status">${filters}</div><table><thead><tr><th>Cluster</th><th>Status</th><th>Rounds</th><th>Judge vendor</th><th>Alternate judge</th><th>Verified</th><th>Discarded</th><th>Conformity suspect</th></tr></thead><tbody>${data.clusters.map((cluster) => row(data, cluster)).join('')}</tbody></table><h3>Not debated (cap)</h3><ul>${gaps}</ul></section>`;
  },
};
