// Rail 05. Clusters are sorted by severity. Rows that were debated or agreed at triage stay in the
// open table. Past-cap clusters are a collapsed table with titles: a bare id list repeats the judge dump
// and does not say which finding was left out. Counts that were never measured are a dash, not a zero.
import { esc } from './report-cards.mjs';
import { FINAL, statusPill } from './report-section-status-legend.mjs';
import { citationState, turnsOf } from './report-section-v2-data.mjs';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const severityRank = (cluster) => SEVERITY_RANK[String(cluster.severity || '').toLowerCase()] ?? 5;
const idNum = (id) => { const n = /(\d+)/.exec(String(id || '')); return n ? Number(n[1]) : 0; };
const byImpact = (a, b) => severityRank(a) - severityRank(b) || idNum(a.id) - idNum(b.id) || String(a.id).localeCompare(String(b.id));

const statusOf = (data, cluster) => {
  if (cluster.status === 'AGREED') return 'AGREED';
  return data.byCluster.get(cluster.id)?.finalStatus || cluster.status || '';
};

// Turn files win when they exist. An agreed cluster, and a queued cluster that never started, stay at 0.
function roundsOf(cluster, turns) {
  const fromTurns = turns.reduce((n, turn) => Math.max(n, turn.round || 0), 0);
  if (fromTurns > 0) return fromTurns;
  return cluster.status === 'AGREED' || cluster.rounds === 0 || !Number.isFinite(cluster.rounds) ? 0 : cluster.rounds;
}

function judgeOf(data, cluster) {
  const judge = data.byCluster.get(cluster.id)?.judge || {};
  const id = String(judge.reviewerId || '');
  const vendor = String(judge.vendor || '');
  if (!id && !vendor) return { label: '—', alternate: false };
  if (id === 'triage' || vendor === 'none') return { label: 'triage', alternate: false };
  if (id === 'rules' || vendor === 'rules') return { label: 'rules', alternate: false };
  return { label: vendor || id, alternate: Boolean(judge.alternate) };
}

function metrics(data, cluster) {
  const turns = turnsOf(data, cluster.id);
  const checked = turns.flatMap((turn) => (turn.citations || []).map((citation) => citationState(data, turn, citation)));
  const count = (n) => (turns.length ? String(n) : '—');
  return {
    rounds: roundsOf(cluster, turns),
    verified: count(checked.filter((citation) => citation.valid).length),
    discarded: count(checked.filter((citation) => !citation.valid).length),
    conformity: count(turns.filter((turn) => turn.conformitySuspect).length),
  };
}

function clusterCell(cluster) {
  const title = cluster.primaryTitle || cluster.id;
  return `<a href="#finding-${esc(cluster.id)}"><span class="cluster-id">${esc(cluster.id)}</span> ${esc(title)}</a>`;
}

function severityCell(cluster) {
  const name = String(cluster.severity || 'unknown').toLowerCase();
  return `<span class="sev sev-${esc(name)}">${esc(name)}</span>`;
}

const prettyStatus = (status) => String(status || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Only the debate cap leaves this table. debate_time and a missing devil turn are gaps on clusters that were queued.
export function capClusters(data) {
  const byId = new Map((data.clusters || []).map((cluster) => [cluster.id, cluster]));
  const rows = [];
  const seen = new Set();
  const add = (cluster) => {
    if (!cluster?.id || seen.has(cluster.id)) return;
    seen.add(cluster.id);
    rows.push(cluster);
  };
  for (const gap of data.coverageGaps || []) {
    if ((gap?.reason || 'debate_cap') !== 'debate_cap') continue;
    add(byId.get(gap.clusterId) || { id: gap.clusterId, primaryTitle: gap.clusterId, status: 'CAPPED', severity: '' });
  }
  for (const cluster of data.clusters || []) if (cluster.status === 'CAPPED') add(cluster);
  return rows.sort(byImpact);
}

function debatedRow(data, cluster) {
  const status = statusOf(data, cluster);
  const judge = judgeOf(data, cluster);
  const measured = metrics(data, cluster);
  return `<tr data-status="${esc(status)}" data-severity="${esc(String(cluster.severity || ''))}"><td>${severityCell(cluster)}</td><td class="cluster">${clusterCell(cluster)}</td><td>${statusPill(status)}</td><td class="num">${measured.rounds}</td><td>${esc(judge.label)}</td><td>${judge.alternate ? 'yes' : '—'}</td><td class="num">${measured.verified}</td><td class="num">${measured.discarded}</td><td class="num">${measured.conformity}</td></tr>`;
}

function capRow(data, cluster) {
  const status = statusOf(data, cluster);
  return `<tr data-status="${esc(status)}" data-severity="${esc(String(cluster.severity || ''))}"><td>${severityCell(cluster)}</td><td class="cluster">${clusterCell(cluster)}</td><td>${statusPill(status)}</td><td>Debate cap</td></tr>`;
}

export const section = {
  id: 'crosscheck',
  order: 50,
  slot: 'evidence',
  rail: { num: '05', label: 'Cross-check', anchor: 'crosscheck' },
  pages: ['report'],
  render(data) {
    const capped = capClusters(data);
    const cappedIds = new Set(capped.map((cluster) => cluster.id));
    const debated = (data.clusters || []).filter((cluster) => !cappedIds.has(cluster.id)).sort(byImpact);
    const filters = FINAL.map((status) => `<button type="button" class="filter-btn" data-cross-filter="${status}" aria-pressed="false">${esc(prettyStatus(status))}</button>`).join('');
    const head = '<thead><tr><th>Severity</th><th>Cluster</th><th>Status</th><th class="num">Rounds</th><th>Judge</th><th>Alternate</th><th class="num">Verified</th><th class="num">Discarded</th><th class="num">Conformity</th></tr></thead>';
    const main = `<details class="panel" id="crosscheck-debated" open><summary>Debated and agreed<span class="meta-label">${debated.length} clusters</span></summary><div class="panel-body"><div class="table-scroll"><table class="dense-table cross-table">${head}<tbody>${debated.map((cluster) => debatedRow(data, cluster)).join('')}</tbody></table></div></div></details>`;
    const cap = capped.length ? `<details class="panel" id="crosscheck-cap"><summary>Not debated (cap)<span class="meta-label">${capped.length} clusters</span></summary><div class="panel-body"><p class="note">These findings were reported, then left outside the debate cap, so nobody argued them. The status is the citation-rule result. Expanding this table shows the finding title and severity.</p><div class="table-scroll"><table class="dense-table"><thead><tr><th>Severity</th><th>Cluster</th><th>Status</th><th>Why</th></tr></thead><tbody>${capped.map((cluster) => capRow(data, cluster)).join('')}</tbody></table></div></div></details>` : '';
    return `<section id="crosscheck" class="report-block" aria-label="Cross-check"><div class="section-heading"><h2><span class="section-num">05</span>Cross-check</h2><span class="meta-label">${(data.clusters || []).length} clusters · sorted by severity</span></div><p class="note">Highest severity first. Agreed rows were not debated: two vendors cited the same defect, so rounds are 0 and the other counts are a dash. A dash means those counts were not measured.</p><div class="filter-group" role="group" aria-label="Filter clusters by status">${filters}</div>${main}${cap}</section>`;
  },
};
