// General review (ORCHESTRATION 4.4). Every count, status and posture is computed from the adjudication;
// the orchestrator model supplies only the executive summary and the wording of open disagreements, and
// cannot name a cluster that was not adjudicated (bridge-tools-orchestrator.acceptGeneralReview).
import { validate } from '../../packages/schemas/index.mjs';

export const DISCLAIMER = 'Model agreement and passing checks do not certify security.';
const RANK = { CONFIRMED: 0, LIKELY: 1, DISPUTED: 2, INSUFFICIENT_EVIDENCE: 3, REFUTED: 4 };
const SEVERITY = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const OPEN = new Set(['CONFIRMED', 'LIKELY', 'DISPUTED']);

export function riskPosture(rows) {
  const open = rows.filter((row) => OPEN.has(row.finalStatus)).map((row) => row.severity);
  if (open.includes('critical')) return 'critical-exposure';
  if (open.includes('high')) return 'high-risk';
  if (open.includes('medium')) return 'moderate';
  return 'low-observed';
}

export function topFindings(rows, clusters) {
  const byId = new Map(clusters.map((row) => [row.id, row]));
  return [...rows].sort((a, b) => RANK[a.finalStatus] - RANK[b.finalStatus] || SEVERITY[a.severity] - SEVERITY[b.severity] || a.clusterId.localeCompare(b.clusterId, 'en', { numeric: true }))
    .slice(0, 10).map((row) => ({
      clusterId: row.clusterId, title: byId.get(row.clusterId)?.primaryTitle || row.clusterId, severity: row.severity, finalStatus: row.finalStatus,
      location: (byId.get(row.clusterId)?.anchors || []).map((anchor) => `${anchor.file}:${anchor.line}`),
    }));
}

function coverage(scope, clusters, gaps, failedSurfaces) {
  return scope.map((surface) => ({
    surface, covered: !failedSurfaces.has(surface),
    gaps: [...new Set(gaps.filter((gap) => clusters.find((row) => row.id === gap.clusterId)?.surface?.toUpperCase().startsWith(surface)).map((gap) => gap.reason))],
  }));
}

function contributions(reviewers, rows, clusters, usage) {
  const byId = new Map(clusters.map((row) => [row.id, row]));
  return reviewers.map((reviewer) => {
    const authored = rows.filter((row) => byId.get(row.clusterId)?.authors.includes(reviewer.id));
    const sole = authored.filter((row) => byId.get(row.clusterId).authors.length === 1 && ['CONFIRMED', 'LIKELY'].includes(row.finalStatus));
    const spent = usage.get(reviewer.id) || { calls: 0, cost: null };
    return { reviewerId: reviewer.id, uniqueConfirmed: sole.length, refuted: authored.filter((row) => row.finalStatus === 'REFUTED').length, toolCalls: spent.calls, costUsd: spent.cost };
  });
}

// input: {rows, clusters, gaps, scope, failedSurfaces, reviewers, usage, methodology, summary}
export function composeGeneralReview({ rows, clusters, gaps, scope, failedSurfaces = new Set(), reviewers, usage = new Map(), methodology, summary }) {
  const disputed = rows.filter((row) => row.finalStatus === 'DISPUTED');
  const worded = new Map((summary.openDisagreements || []).map((row) => [row.clusterId, row.summary]));
  const general = {
    executiveSummary: summary.executiveSummary,
    riskPosture: riskPosture(rows),
    topFindings: topFindings(rows, clusters),
    coverage: coverage(scope, clusters, gaps, failedSurfaces),
    openDisagreements: disputed.map((row) => ({ clusterId: row.clusterId, summary: worded.get(row.clusterId) || row.rationale })),
    contributions: contributions(reviewers, rows, clusters, usage),
    methodology,
    disclaimer: DISCLAIMER,
  };
  const check = validate('general-review', general);
  if (!check.ok) throw new Error(`general review failed its schema: ${check.errors[0]}`);
  return general;
}

export function limitationClause(rows, { gaps = [], failedSurfaces = new Set(), partialSurfaces = [], fallbackReason = null } = {}) {
  const limitations = [];
  if (fallbackReason) limitations.push(`orchestrator synthesis unavailable (${fallbackReason}); generated from verified citation rules`);
  const rulesOnly = rows.filter((row) => row.judge?.reviewerId === 'rules' || /(?:debate_time|debate_threshold|judge_threshold|judge_unavailable|debate_cap|pass2_budget_restored_from_pass1)/.test(row.rationale || '')).length;
  if (rulesOnly) limitations.push(`${rulesOnly} cluster(s) adjudicated by deterministic citation rules`);
  const failedList = [...failedSurfaces];
  if (failedList.length) limitations.push(`incomplete surfaces: ${failedList.join(', ')}`);
  const partialList = [...new Set(partialSurfaces)].filter(Boolean);
  if (partialList.length) limitations.push(`partial passes (restored earlier pass or budget limit): ${partialList.join(', ')}`);
  const gapReasons = [...new Set(gaps.map((g) => g?.reason).filter(Boolean).filter((r) => r !== 'debate_cap'))];
  if (gapReasons.length) limitations.push(`recorded debate/coverage gaps: ${gapReasons.join(', ')}`);
  return limitations.length ? `Open questions and limitations: ${limitations.join('; ')}.` : '';
}

// The summary when no model writes one (scripted orchestrator, nothing to adjudicate, or fallback when threshold/timeout reached): counts and limitations.
export function rulesSummary(rows, options = {}) {
  const { gaps = [], failedSurfaces = new Set(), partialSurfaces = [], fallbackReason = null } = options || {};
  if (!rows.length && !fallbackReason) return { executiveSummary: 'No committed finding reached adjudication.', openDisagreements: [] };
  const counts = Object.keys(RANK).map((status) => [status, rows.filter((row) => row.finalStatus === status).length]).filter(([, n]) => n);
  const base = rows.length
    ? `${rows.length} clusters adjudicated from verified citations: ${counts.map(([s, n]) => `${n} ${s}`).join(', ')}.`
    : 'No committed finding reached adjudication.';
  if (!fallbackReason && !partialSurfaces.length) return { executiveSummary: base, openDisagreements: [] };
  const clause = limitationClause(rows, { gaps, failedSurfaces, partialSurfaces, fallbackReason });
  const disputed = rows.filter((row) => row.finalStatus === 'DISPUTED');
  return {
    executiveSummary: clause ? `${base} ${clause}` : base,
    openDisagreements: disputed.map((row) => ({ clusterId: row.clusterId, summary: row.rationale })),
  };
}

export function generalReviewMarkdown(general) {
  const lines = ['# General review', '', general.executiveSummary, '', `Risk posture: ${general.riskPosture}`, '', '## Top findings', ''];
  lines.push(...(general.topFindings.length ? general.topFindings.map((row) => `- [${row.clusterId}](#finding-${row.clusterId}) ${row.title}: ${row.finalStatus} (${row.severity})`) : ['- None adjudicated.']));
  if (general.openDisagreements.length) lines.push('', '## Open disagreements', '', ...general.openDisagreements.map((row) => `- ${row.clusterId}: ${row.summary}`));
  const limitRows = (general.coverage || []).filter((row) => !row.covered || (row.gaps && row.gaps.length));
  const summaryLimit = /Open questions and limitations:\s*(.+)$/.exec(general.executiveSummary || '')?.[1];
  if (limitRows.length || summaryLimit) {
    lines.push('', '## Coverage & limitations', '');
    if (summaryLimit) lines.push(`- ${summaryLimit}`);
    lines.push(...limitRows.map((row) => `- ${row.surface}: ${row.covered ? 'covered' : 'incomplete'}${row.gaps?.length ? ` (gaps: ${row.gaps.join(', ')})` : ''}`));
  }
  lines.push('', '## Contributions', '', '| Reviewer | Unique confirmed | Refuted | Tool calls | Cost USD |', '|---|---|---|---|---|');
  lines.push(...general.contributions.map((row) => `| ${row.reviewerId} | ${row.uniqueConfirmed} | ${row.refuted} | ${row.toolCalls} | ${row.costUsd ?? '—'} |`));
  lines.push('', DISCLAIMER, '');
  return lines.join('\n');
}
