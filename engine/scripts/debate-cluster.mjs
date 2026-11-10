// Triage (ORCHESTRATION 4.1). Clusters come from cluster-findings.mjs, the same rules the report uses. A cluster
// in which two vendors reported the same defect (sameDefect), with every cited line present in the snapshot, is
// AGREED and skips the rounds. A cluster that only merged two vendors' nearby claims is debated like any other. The rest queue by severity, then by severity disagreement, and are capped; overflow is a coverage gap
// and is still adjudicated from its citations (debate-run.mjs), so a capped finding stays in the risk posture.
import { clusterFindings } from './cluster-findings.mjs';
import { anchorEvidence, parseLocation } from './debate-citations.mjs';

export const SEVERITY_WEIGHT = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const unique = (rows) => [...new Set(rows.filter(Boolean))];

const TITLE_NOISE = new Set(['missing', 'check', 'checks', 'checked', 'without', 'with', 'from', 'into', 'does', 'that', 'this', 'there', 'when', 'have', 'lacks', 'allows', 'allow', 'unsafe', 'insecure', 'issue', 'vulnerability', 'validation', 'should', 'never', 'always', 'before', 'after', 'being', 'every']);
const titleWords = (title) => new Set(String(title || '').toLowerCase().split(/[^a-z0-9_]+/).filter((word) => word.length >= 4 && !TITLE_NOISE.has(word)));
const surfaceOf = (finding) => String(finding.surface || '').toUpperCase().slice(0, 2);

// Two claims are the same defect, for the purpose of skipping the debate, only when they cite the same line and
// also agree on what it is: the same surface, or at least two significant title words in common. Clustering
// (cluster-findings.mjs) merges on nearby lines alone, which is right for de-duplication but is not agreement:
// two reviewers can report different defects in the same statement.
export function sameDefect(a, b) {
  const lines = new Set(a.location || []);
  if (!(b.location || []).some((loc) => lines.has(loc))) return false;
  if (surfaceOf(a) && surfaceOf(a) === surfaceOf(b)) return true;
  const words = titleWords(a.title);
  return [...titleWords(b.title)].filter((word) => words.has(word)).length >= 2;
}

// True when two claims of different vendors are the same defect. vendorOf(finding) names a claim's vendor.
export function vendorsAgree(findings, vendorOf) {
  for (let i = 0; i < findings.length; i++) {
    for (let j = i + 1; j < findings.length; j++) {
      const [a, b] = [vendorOf(findings[i]), vendorOf(findings[j])];
      if (a && b && a !== b && sameDefect(findings[i], findings[j])) return true;
    }
  }
  return false;
}

// 'same_claim': two vendors reported the same defect. 'merged_only': two vendors are in the cluster but no pair
// of their claims is the same defect. 'single_vendor' otherwise.
function agreementOf(findings) {
  const vendorOf = (finding) => finding.vendor || finding.reviewerId;
  if (new Set(findings.map(vendorOf).filter(Boolean)).size < 2) return 'single_vendor';
  return vendorsAgree(findings, vendorOf) ? 'same_claim' : 'merged_only';
}

function describe(cluster, reader) {
  const anchors = unique(cluster.findings.flatMap((finding) => finding.location || [])).map(parseLocation).filter(Boolean);
  const evidence = anchors.map((anchor) => anchorEvidence(reader, anchor));
  const vendors = unique(cluster.findings.map((finding) => finding.vendor || finding.reviewerId));
  const citationsOk = evidence.length > 0 && evidence.every((row) => row.valid);
  const disagreement = (cluster.severities || []).length > 1 ? 1 : 0;
  const agreement = agreementOf(cluster.findings);
  return {
    id: cluster.id, primaryTitle: cluster.primaryTitle, surface: cluster.surface, severity: cluster.severity,
    severities: cluster.severities, claimIds: cluster.claimIds,
    authors: unique(cluster.findings.map((finding) => finding.reviewerId)), vendors, anchors, evidence, citationsOk,
    // Severity decides the order; a severity disagreement only moves a cluster ahead of its own severity class,
    // so a disputed medium never takes a debate slot from a critical.
    priority: (SEVERITY_WEIGHT[cluster.severity] || 3) + disagreement / 2,
    agreement,
    agreed: agreement === 'same_claim' && citationsOk,
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
