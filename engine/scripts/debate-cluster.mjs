// Triage (ORCHESTRATION 4.1). Clusters come from cluster-findings.mjs, the same rules the report uses. A cluster
// in which two vendors reported the same defect (sameDefect), with every cited line present in the snapshot, is
// AGREED and skips the rounds. A cluster that only merged two vendors' nearby claims is debated like any other. The rest queue by severity, then by severity disagreement, and are capped; overflow is a coverage gap
// and is still adjudicated from its citations (debate-run.mjs), so a capped finding stays in the risk posture.
import { LINE_TOLERANCE, SITE_MIN_WORDS, clusterFindings, sharedTitleWords } from './cluster-findings.mjs';
import { anchorEvidence, parseLocation } from './debate-citations.mjs';

export const SEVERITY_WEIGHT = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const unique = (rows) => [...new Set(rows.filter(Boolean))];

const surfaceOf = (finding) => String(finding.surface || '').toUpperCase().slice(0, 2);
const anchorsOf = (finding) => (finding.location || []).map((loc) => /^(.+):(\d+)$/.exec(String(loc))).filter(Boolean).map((m) => ({ file: m[1], line: Number(m[2]) }));

// Two claims are the same defect, for the purpose of skipping the debate, only when they cite the same place and
// also agree on what it is. The place: one line (and then the same surface or two shared subject words suffice) or
// lines within LINE_TOLERANCE (and then two shared subject words are required). Clustering (cluster-findings.mjs)
// also merges adjacent lines with no shared words, which is right for de-duplication but is not agreement: two
// reviewers can report different defects in neighbouring statements.
export function sameDefect(a, b) {
  const words = sharedTitleWords(a.title, b.title);
  const bAnchors = anchorsOf(b);
  return anchorsOf(a).some((x) => bAnchors.some((y) => {
    if (x.file !== y.file) return false;
    const gap = Math.abs(x.line - y.line);
    if (gap === 0) return (surfaceOf(a) !== '' && surfaceOf(a) === surfaceOf(b)) || words >= SITE_MIN_WORDS;
    return gap <= LINE_TOLERANCE && words >= SITE_MIN_WORDS;
  }));
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
