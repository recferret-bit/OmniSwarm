// Triage (ORCHESTRATION 4.1). Clusters come from cluster-findings.mjs, the same rules the report uses. A cluster
// that at least two vendors reported, with every cited line present in the snapshot, is AGREED and skips the
// rounds. The rest queue by severityWeight × (1 + disagreement) and are capped; overflow is a coverage gap.
import { clusterFindings } from './cluster-findings.mjs';
import { anchorEvidence, parseLocation } from './debate-citations.mjs';

export const SEVERITY_WEIGHT = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const unique = (rows) => [...new Set(rows.filter(Boolean))];

function describe(cluster, reader) {
  const anchors = unique(cluster.findings.flatMap((finding) => finding.location || [])).map(parseLocation).filter(Boolean);
  const evidence = anchors.map((anchor) => anchorEvidence(reader, anchor));
  const vendors = unique(cluster.findings.map((finding) => finding.vendor || finding.reviewerId));
  const citationsOk = evidence.length > 0 && evidence.every((row) => row.valid);
  const disagreement = (cluster.severities || []).length > 1 ? 1 : 0;
  return {
    id: cluster.id, primaryTitle: cluster.primaryTitle, surface: cluster.surface, severity: cluster.severity,
    severities: cluster.severities, claimIds: cluster.claimIds,
    authors: unique(cluster.findings.map((finding) => finding.reviewerId)), vendors, anchors, evidence, citationsOk,
    priority: (SEVERITY_WEIGHT[cluster.severity] || 3) * (1 + disagreement),
    agreed: vendors.length >= 2 && citationsOk,
  };
}

export function buildClusters(claims, { reader, maxClusters = 25 } = {}) {
  const rows = clusterFindings(claims).map((cluster) => describe(cluster, reader));
  const agreed = rows.filter((row) => row.agreed).map(({ agreed: _, ...row }) => ({ ...row, status: 'AGREED', rounds: 0 }));
  const queued = rows.filter((row) => !row.agreed).map(({ agreed: _, ...row }) => row)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id, 'en', { numeric: true }));
  const kept = queued.slice(0, maxClusters).map((row) => ({ ...row, status: 'QUEUED' }));
  const capped = queued.slice(maxClusters).map((row) => ({ ...row, status: 'CAPPED', rounds: 0 }));
  return { clusters: [...agreed, ...kept, ...capped], coverageGaps: capped.map((row) => ({ clusterId: row.id, reason: 'debate_cap' })) };
}
