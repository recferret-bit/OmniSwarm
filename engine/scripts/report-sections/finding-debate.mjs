// Per-finding Debate disclosure: every anonymized turn with its citation chips (✓ only when the checker
// verified that citation for this cluster), the judge's rationale and the final status. The card is joined to
// its debate cluster by claim id (row.debateClusterId), never by position.
import { esc } from '../report-cards.mjs';
import { statusPill } from './status-legend.mjs';
import { citationState, turnsOf } from './v2-data.mjs';

function turnHtml(data, turn) {
  const chips = (turn.citations || []).map((citation) => {
    const state = citationState(data, turn, citation);
    return `<code class="citation-chip">${esc(citation.file)}:${esc(citation.startLine)} ${state.valid ? '✓' : `✗ ${esc(state.reason)}`}</code>`;
  }).join(' ');
  const tags = `${turn.devilAdvocate ? '<span class="pill">devil\'s advocate</span>' : ''} ${turn.conformitySuspect ? '<span class="pill">conformity suspect</span>' : ''}`;
  return `<p><b>${esc(turn.anonId)}</b> round ${esc(turn.round)} ${esc(turn.verdict)} ${tags}</p><p>${esc(turn.argument)}</p>${chips}`;
}

export const section = {
  id: 'finding-debate',
  order: 20,
  slot: 'card',
  pages: ['report', 'reviewer'],
  render(data, finding) {
    const clusterId = finding?.debateClusterId;
    if (!clusterId) return '';
    const turns = turnsOf(data, clusterId);
    const judged = data.byCluster.get(clusterId);
    if (!turns.length && !judged) return '';
    return `<details class="disclosure debate"><summary>Debate</summary><div>${turns.map((turn) => turnHtml(data, turn)).join('')}<p>${esc(judged?.rationale || '')}</p>${judged?.severityReason ? `<p>${esc(judged.severityReason)}</p>` : ''}${judged?.finalStatus ? statusPill(judged.finalStatus) : ''}</div></details>`;
  },
};
