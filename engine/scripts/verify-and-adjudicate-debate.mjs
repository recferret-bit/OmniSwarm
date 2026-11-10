// Merge the debate outcome into findings-and-scores.json (ORCHESTRATION 6). Report clusters and debate clusters
// come from the same clusterFindings call over the same claims, so they are joined by claim id, never by the
// positional CLUSTER-n. A run without debate/ keeps today's rows byte for byte.
import { readJsonOr } from './report-util-files.mjs';

const FINAL_MULTIPLIER = { AGREED: 0.9, CONFIRMED: 0.9, LIKELY: 0.7, DISPUTED: 0.6, INSUFFICIENT_EVIDENCE: 0.5, REFUTED: 0 };

function outcomeOf(cluster, judged) {
  if (cluster.status === 'AGREED') return { finalStatus: 'AGREED', debateRounds: 0, judge: judged?.judge || null, severityReason: judged?.severityReason || null };
  // A capped cluster was not debated; its status comes from the citation rules alone and the gap stays on the row.
  if (cluster.status === 'CAPPED') return { debateGap: 'debate_cap', debateRounds: 0, ...(judged ? { finalStatus: judged.finalStatus, judge: judged.judge, severityReason: judged.severityReason || null } : {}) };
  if (!judged) return { debateGap: 'not_adjudicated', debateRounds: 0 };
  return { finalStatus: judged.finalStatus, debateRounds: cluster.rounds || 0, judge: judged.judge, severityReason: judged.severityReason || null, severity: judged.severity };
}

// rows: scored findings; weights: severity -> base score. Returns new rows (sorted by score) or the input untouched.
export function mergeDebateOutcome(reportDir, rows, weights) {
  const clusters = readJsonOr(reportDir, 'debate/clusters.json', null)?.clusters;
  if (!Array.isArray(clusters)) return rows;
  const adjudication = readJsonOr(reportDir, 'debate/adjudication.json', []);
  const judged = new Map((Array.isArray(adjudication) ? adjudication : []).map((row) => [row.clusterId, row]));
  const merged = rows.map((row) => {
    const ids = new Set(row.claimIds || []);
    const cluster = clusters.find((c) => (c.claimIds || []).some((id) => ids.has(id)));
    if (!cluster) return { ...row, debateGap: 'not_debated' };
    const { severity, ...outcome } = outcomeOf(cluster, judged.get(cluster.id));
    const next = { ...row, debateClusterId: cluster.id, ...outcome };
    if (severity && severity !== row.severity) Object.assign(next, { severity, reportedSeverity: row.severity });
    if (next.finalStatus) next.score = Number(((weights[next.severity] || 5) * FINAL_MULTIPLIER[next.finalStatus]).toFixed(1));
    return next;
  });
  return merged.sort((a, b) => b.score - a.score);
}
