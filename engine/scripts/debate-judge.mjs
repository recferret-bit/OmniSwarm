// Adjudication (ORCHESTRATION 4.3). Cross-family rule: the judge's vendor differs from every author's vendor of
// the cluster; otherwise the alternate judge (explicit, else the first run reviewer of another vendor) takes it,
// and with no independent judge the cluster stays DISPUTED. A model judge cannot go past the evidence floor in
// debate-rules.mjs (no silent drop of a single-source finding without a valid refutation).
import { allowedVerdicts, judgeVisible, rulesVerdict } from './debate-rules.mjs';

const label = (turn, text) => `${turn.anonId} round ${turn.round}: ${text}`;
const isScripted = (reviewer) => reviewer?.family === 'scripted';

// The scripted judge is the citation rules, not a model, so it has no family to favour. It only runs on
// fixture targets (debate-plan.mjs refuses it elsewhere).
export function pickJudge(cluster, { orchestrator, alternate = null, reviewers = [] }) {
  if (isScripted(orchestrator)) return { reviewer: orchestrator, record: { reviewerId: orchestrator.id, vendor: orchestrator.vendor, alternate: false }, rules: true };
  const authors = new Set(cluster.vendors);
  if (orchestrator && !authors.has(orchestrator.vendor)) return { reviewer: orchestrator, record: { reviewerId: orchestrator.id, vendor: orchestrator.vendor, alternate: false } };
  const candidates = [alternate, ...reviewers.filter((row) => !isScripted(row))].filter(Boolean);
  const other = candidates.find((row) => !authors.has(row.vendor));
  return other ? { reviewer: other, record: { reviewerId: other.id, vendor: other.vendor, alternate: true } } : null;
}

function argumentsOf(turns) {
  return {
    validArguments: judgeVisible(turns).map((turn) => label(turn, turn.verdict)),
    discardedArguments: turns.filter((turn) => turn.discarded || turn.conformitySuspect).map((turn) => label(turn, turn.discarded ? turn.reason : 'conformity_suspect')),
  };
}

export function agreedAdjudication(cluster) {
  return {
    clusterId: cluster.id, finalStatus: 'CONFIRMED', severity: cluster.severity, severityReason: 'Left at the reported severity.',
    judge: { reviewerId: 'triage', vendor: 'none', alternate: false },
    rationale: `AGREED at triage: ${cluster.vendors.length} vendors cited lines present in the snapshot.`, validArguments: [], discardedArguments: [],
  };
}

// judgeVoice(choice) -> async ({cluster, turns, judge, validArguments, discardedArguments}) -> body | {unavailable}
export async function adjudicateCluster(cluster, turns, choice, judgeVoice) {
  const mechanical = rulesVerdict(cluster, turns);
  const args = argumentsOf(turns);
  const base = { clusterId: cluster.id, severity: cluster.severity, severityReason: 'Left at the reported severity.', ...args };
  if (!choice) return { row: { ...base, finalStatus: 'DISPUTED', judge: { reviewerId: 'none', vendor: 'none', alternate: false }, rationale: 'no_independent_judge: every available judge shares a vendor with an author of this cluster.' } };
  if (choice.rules) return { row: { ...base, finalStatus: mechanical, judge: choice.record, rationale: `${mechanical} from verified citations only (scripted judge).` } };
  const body = await judgeVoice(choice)({ cluster, turns, judge: choice.record, ...args });
  if (!body || body.unavailable) {
    return { row: { ...base, finalStatus: mechanical, judge: choice.record, rationale: `judge_unavailable (${body?.unavailable || 'no answer'}); ${mechanical} from the citation rules only.` }, gap: { clusterId: cluster.id, reason: 'judge_unavailable' } };
  }
  const allowed = allowedVerdicts(cluster, turns);
  const clamped = allowed.has(body.finalStatus) ? body.finalStatus : mechanical;
  return {
    row: {
      ...base, finalStatus: clamped, judge: choice.record,
      severity: body.severity || cluster.severity, severityReason: body.severityReason || base.severityReason,
      rationale: clamped === body.finalStatus ? body.rationale : `${body.rationale} (The verified arguments do not support ${body.finalStatus}; kept ${mechanical}.)`,
    },
  };
}
