// Adjudication (ORCHESTRATION 4.3). Cross-family rule: the judge's vendor differs from every author's vendor of
// the cluster; otherwise the alternate judge (explicit, else the first run reviewer of another vendor) takes it,
// and with no independent judge the cluster stays DISPUTED. A model judge cannot go past the evidence floor in
// debate-rules.mjs (no silent drop of a single-source finding without a valid refutation).
import { boundedCall } from './debate-clock.mjs';
import { allowedVerdicts, judgeVisible, rulesVerdict } from './debate-rules.mjs';
import { DEFAULTS } from './run-config.mjs';

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

// One replacement after a DISPUTED or unanswered judgement, from reviewers that neither authored nor argued on
// the cluster. Prefer a different vendor, then a different model, then any other independent reviewer. The stored judge record stays
// the closed {reviewerId, vendor, alternate} shape.
export function pickReplacementJudge(cluster, { orchestrator = null, alternate = null, reviewers = [], exclude = [], spoke = [] } = {}) {
  const authors = new Set(cluster.vendors);
  const excludedIds = new Set(exclude.map((row) => row?.id).filter(Boolean));
  const speakers = new Set(spoke);
  const excludedVendors = new Set(exclude.map((row) => row?.vendor).filter(Boolean));
  const excludedModels = new Set(exclude.map((row) => row?.model).filter(Boolean));
  const pool = [];
  for (const row of [alternate, orchestrator, ...reviewers]) {
    // A reviewer that argued on this cluster is not a second opinion on it.
    if (!row || isScripted(row) || excludedIds.has(row.id) || authors.has(row.vendor) || speakers.has(row.id)) continue;
    if (pool.some((have) => have.id === row.id)) continue;
    pool.push(row);
  }
  const choice = pool.find((row) => !excludedVendors.has(row.vendor))
    || pool.find((row) => row.model && !excludedModels.has(row.model))
    || pool[0]
    || null;
  if (!choice) return null;
  return { reviewer: choice, record: { reviewerId: choice.id, vendor: choice.vendor, alternate: choice.id !== orchestrator?.id } };
}

function argumentsOf(turns) {
  return {
    validArguments: judgeVisible(turns).map((turn) => label(turn, turn.verdict)),
    discardedArguments: turns.filter((turn) => turn.discarded || turn.conformitySuspect).map((turn) => label(turn, turn.discarded ? turn.reason : 'conformity_suspect')),
  };
}

// A cluster the phase clock never started or that was skipped after the unanswered-turn threshold.
export function unheardAdjudication(cluster, reason = 'debate_time') {
  const mechanical = rulesVerdict(cluster, []);
  const detail = reason === 'debate_threshold'
    ? 'debate_threshold: unanswered debate turn threshold reached before this cluster was heard'
    : reason === 'cancelled'
      ? 'cancelled: the debate was cancelled before this cluster was heard'
      : reason === 'debate_cap'
        ? 'debate_cap: cluster exceeded maxClusters and was adjudicated by citation rules'
        : reason === 'pass2_budget_restored_from_pass1'
          ? 'pass2_budget_restored_from_pass1: restored from Pass-1 submission after Pass-2 tool budget limit'
          : 'debate_time: the debate phase clock expired before this cluster was heard';
  return {
    clusterId: cluster.id, finalStatus: mechanical, severity: cluster.severity, severityReason: 'Left at the reported severity.',
    judge: { reviewerId: 'rules', vendor: 'rules', alternate: false },
    rationale: `${mechanical} from verified citations only (${detail}).`,
    validArguments: [], discardedArguments: [],
  };
}

export function agreedAdjudication(cluster) {
  return {
    clusterId: cluster.id, finalStatus: 'CONFIRMED', severity: cluster.severity, severityReason: 'Left at the reported severity.',
    judge: { reviewerId: 'triage', vendor: 'none', alternate: false },
    rationale: `AGREED at triage: ${cluster.vendors.length} vendors reported the same defect on the same line, and every cited line is present in the snapshot.`, validArguments: [], discardedArguments: [],
  };
}

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

// The judge may re-calibrate severity. Lowering it needs a stated reason; without one the reported severity stays.
function judgedSeverity(cluster, body, base) {
  const proposed = body.severity && SEVERITY_RANK[body.severity] != null ? body.severity : cluster.severity;
  const reason = String(body.severityReason || '').trim();
  const lowered = SEVERITY_RANK[proposed] < (SEVERITY_RANK[cluster.severity] ?? 0);
  if (lowered && !reason) return { severity: cluster.severity, severityReason: `Left at the reported severity: the judge proposed ${proposed} without a reason.` };
  return { severity: proposed, severityReason: reason || base.severityReason };
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
      ...judgedSeverity(cluster, body, base),
      rationale: clamped === body.finalStatus ? body.rationale : `${body.rationale} (The verified arguments do not support ${body.finalStatus}; kept ${mechanical}.)`,
    },
  };
}

const judgeTrace = (cluster, row) => ({ phase: 'adjudicate', template: 'judge', clusterId: cluster.id, judge: row.judge.reviewerId, alternate: row.judge.alternate, stop: row.finalStatus });

// The first judge is final when it resolves the cluster. DISPUTED, or a judge that did not answer, is tried
// once more on a different model. A second miss keeps the first row and the first gap.
export async function adjudicateWithRetry(cluster, turns, plan) {
  const choice = pickJudge(cluster, plan);
  const turnMs = plan.turnMs ?? DEFAULTS.debate.turnMs;
  const voice = (picked) => (args) => boundedCall(turnMs, plan.signal, (signal) => plan.judgeVoice(picked)({ ...args, signal }));
  let { row, gap } = await adjudicateCluster(cluster, turns, choice, voice);
  const trace = [judgeTrace(cluster, row)];
  const retry = choice && !choice.rules && (row.finalStatus === 'DISPUTED' || gap?.reason === 'judge_unavailable');
  if (!retry) return { row, gap, trace };
  const replacement = pickReplacementJudge(cluster, { ...plan, exclude: [choice.reviewer], spoke: turns.map((turn) => turn.speaker).filter(Boolean) });
  if (!replacement) return { row, gap, trace };
  const second = await adjudicateCluster(cluster, turns, replacement, voice);
  trace.push({ phase: 'adjudicate', template: 'judge-retry', clusterId: cluster.id, judge: replacement.record.reviewerId, previous: row.judge.reviewerId, stop: second.gap ? 'unavailable' : second.row.finalStatus });
  if (second.gap) return { row, gap, trace };
  if (gap || second.row.finalStatus !== 'DISPUTED') {
    const lead = gap?.reason === 'judge_unavailable' ? 'No answer from' : 'No agreement from';
    return {
      row: { ...second.row, rationale: `${lead} ${choice.record.reviewerId}. Retried with ${replacement.record.reviewerId}. ${second.row.rationale}` },
      gap: null,
      trace,
    };
  }
  return { row: { ...row, rationale: `${row.rationale} Retried with ${replacement.record.reviewerId}: still disputed.` }, gap, trace };
}
