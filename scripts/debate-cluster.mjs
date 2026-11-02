// Queue clusters for debate. Two vendors with valid citations are AGREED and skip the rounds.
import { clusterFindings } from './cluster-findings.mjs';
import { checkCitation } from './debate-citations.mjs';

const WEIGHT = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export function buildClusters(findings, { sourceRoot, maxClusters = 25, vendors = {} } = {}) {
  const clustered = clusterFindings(findings);
  const rows = clustered.map((cluster) => {
    const vendorSet = [...new Set(cluster.auditors.map((id) => vendors[id] || id))];
    const citations = cluster.findings.flatMap((finding) => (finding.location || []).map((loc) => {
      const [file, line] = String(loc).split(':');
      return checkCitation(sourceRoot, { file, startLine: Number(line), endLine: Number(line), quote: finding.quote || '' });
    }));
    const citationsOk = citations.length > 0 && citations.every((row) => row.valid);
    const agreed = vendorSet.length >= 2 && citationsOk;
    const disagreement = (cluster.severities || []).length > 1 ? 1 : 0;
    const priority = (WEIGHT[cluster.severity] || 3) * (1 + disagreement);
    return { ...cluster, vendors: vendorSet, citations, status: agreed ? 'AGREED' : 'QUEUED', rounds: agreed ? 0 : undefined, priority };
  });
  const agreed = rows.filter((row) => row.status === 'AGREED');
  const queued = rows.filter((row) => row.status !== 'AGREED').sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const kept = queued.slice(0, maxClusters);
  const coverageGaps = queued.slice(maxClusters).map((row) => ({ clusterId: row.id, reason: 'debate_cap' }));
  return { clusters: [...agreed, ...kept.map((row) => ({ ...row, status: 'QUEUED' })), ...queued.slice(maxClusters).map((row) => ({ ...row, status: 'CAPPED', rounds: 0 }))], coverageGaps };
}
