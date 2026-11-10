// The three debate stages over a plan from debate-plan.mjs. Each stage writes its files under debate/ (or
// general-review.*) and returns state for the next. A stage that cannot finish throws a coded error; the phase
// runner records it in meta.stageFailures and the report shows INCOMPLETE with every per-model finding intact.
import { buildClusters } from './debate-cluster.mjs';
import { boundedCall } from './debate-clock.mjs';
import { runRounds } from './debate-rounds.mjs';
import { adjudicateWithRetry, agreedAdjudication, pickJudge, unheardAdjudication } from './debate-judge.mjs';
import { judgeVisible, rulesVerdict } from './debate-rules.mjs';
import { composeGeneralReview, generalReviewMarkdown, limitationClause, rulesSummary } from './debate-general-review.mjs';
import { offlinePlan, stageError } from './debate-plan.mjs';
import { DEFAULTS } from './run-config.mjs';
import { validate } from '../../packages/schemas/index.mjs';
import { writeJson, writeText } from './report-util-files.mjs';

const DEFAULT_MAX_JUDGE_UNAVAILABLE = 3;
const writeTrace = (out, rows) => writeText(out, 'debate/trace.jsonl', rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));

function thresholdAdjudication(cluster, turns, choice, reason) {
  const mechanical = rulesVerdict(cluster, turns);
  return {
    clusterId: cluster.id, finalStatus: mechanical, severity: cluster.severity, severityReason: 'Left at the reported severity.',
    judge: choice?.record || { reviewerId: 'rules', vendor: 'rules', alternate: false },
    rationale: `${mechanical} from verified citations only (${reason}: judge threshold reached).`,
    validArguments: judgeVisible(turns).map((t) => `${t.anonId} round ${t.round}: ${t.verdict}`),
    discardedArguments: turns.filter((t) => t.discarded).map((t) => `${t.anonId} round ${t.round}: ${t.reason}`),
  };
}

export async function debateStage(plan) {
  const built = buildClusters(plan.claims, { reader: plan.reader, maxClusters: plan.maxClusters });
  const names = [...plan.reviewers.flatMap((r) => [r.id, r.vendor, r.model])];
  const result = await runRounds({
    out: plan.out, clusters: built.clusters, voices: plan.voices, vendors: plan.vendors, reader: plan.reader,
    rounds: plan.rounds, seed: plan.seed, names, turnMs: plan.turnMs, phaseMs: plan.phaseMs,
    ...(plan.maxUnanswered != null ? { maxUnanswered: plan.maxUnanswered } : {}),
    ...(plan.maxSpeakerUnanswered != null ? { maxSpeakerUnanswered: plan.maxSpeakerUnanswered } : {}),
    now: plan.now, signal: plan.signal,
    prior: plan.prior || null,
    judgeOf: (cluster) => { const choice = pickJudge(cluster, plan); return choice && !choice.rules ? choice.reviewer.id : null; },
  });
  const unheard = new Set(result.skipped);
  const clusters = built.clusters.map((row) => {
    if (unheard.has(row.id)) return { ...row, rounds: 0 };
    return result.debated.has(row.id) ? { ...row, rounds: result.debated.get(row.id).rounds } : row;
  });
  // Phase-clock or threshold skips are coverage gaps. They stay out of `gaps`, which is the missing-answer list.
  const coverageGaps = [...built.coverageGaps, ...result.skipped.map((clusterId) => ({ clusterId, reason: result.skippedReasons?.get(clusterId) || 'debate_time' }))];
  writeJson(plan.out, 'debate/clusters.json', { clusters, coverageGaps });
  writeJson(plan.out, 'debate/anonymization.json', result.anonymization);
  writeJson(plan.out, 'debate/citations.json', result.citations);
  writeTrace(plan.out, result.trace);
  return { clusters, coverageGaps, debated: result.debated, gaps: result.gaps, trace: result.trace, unheard: result.skipped, unheardReasons: result.skippedReasons };
}

export async function adjudicateStage(plan, state) {
  const rows = [];
  const gaps = [];
  const maxUnavailable = plan.maxJudgeUnavailable ?? DEFAULT_MAX_JUDGE_UNAVAILABLE;
  let consecutiveUnavailable = 0;
  for (const cluster of state.clusters) {
    if (cluster.status === 'CAPPED') {
      // Not debated, but not dropped: the citation rules give it a status so the risk posture still counts it.
      const row = unheardAdjudication(cluster, 'debate_cap');
      const check = validate('adjudication', row);
      if (!check.ok) throw stageError('adjudication_invalid', `adjudication for ${cluster.id} failed its schema: ${check.errors[0]}`);
      rows.push(row);
      state.trace.push({ phase: 'adjudicate', template: 'rules', clusterId: cluster.id, stop: row.finalStatus, reason: 'debate_cap' });
      continue;
    }
    if (cluster.status === 'AGREED') { rows.push(agreedAdjudication(cluster)); continue; }
    if (state.unheard?.includes(cluster.id)) {
      const reason = state.unheardReasons?.get(cluster.id) || 'debate_time';
      const row = unheardAdjudication(cluster, reason);
      const check = validate('adjudication', row);
      if (!check.ok) throw stageError('adjudication_invalid', `adjudication for ${cluster.id} failed its schema: ${check.errors[0]}`);
      rows.push(row);
      state.trace.push({ phase: 'adjudicate', template: 'rules', clusterId: cluster.id, stop: row.finalStatus, reason });
      continue;
    }
    const turns = state.debated.get(cluster.id)?.turns || [];
    if (plan.signal?.aborted || consecutiveUnavailable >= maxUnavailable) {
      const reason = plan.signal?.aborted ? 'cancelled' : 'judge_threshold';
      const row = thresholdAdjudication(cluster, turns, pickJudge(cluster, plan), reason);
      const check = validate('adjudication', row);
      if (!check.ok) throw stageError('adjudication_invalid', `adjudication for ${cluster.id} failed its schema: ${check.errors[0]}`);
      rows.push(row);
      gaps.push({ clusterId: cluster.id, reason: 'judge_unavailable', detail: reason });
      state.trace.push({ phase: 'adjudicate', template: 'rules', clusterId: cluster.id, stop: row.finalStatus, reason });
      continue;
    }
    const judged = await adjudicateWithRetry(cluster, turns, plan);
    const check = validate('adjudication', judged.row);
    if (!check.ok) throw stageError('adjudication_invalid', `adjudication for ${cluster.id} failed its schema: ${check.errors[0]}`);
    rows.push(judged.row);
    if (judged.gap) {
      gaps.push(judged.gap);
      if (judged.gap.reason === 'judge_unavailable') consecutiveUnavailable += 1;
    } else {
      consecutiveUnavailable = 0;
    }
    state.trace.push(...judged.trace);
  }
  writeJson(plan.out, 'debate/adjudication.json', rows);
  writeTrace(plan.out, state.trace);
  return { ...state, rows, missing: [...state.gaps, ...gaps] };
}

// Turns or judgements that had no answer leave the run INCOMPLETE; the adjudication written above stays.
export function missingAnswersError(missing) {
  return stageError('debate_incomplete', `debate_incomplete: ${missing.length} turn(s) or judgement(s) had no answer (${[...new Set(missing.map((g) => g.reason))].join(', ')})`);
}

export async function generalReviewStage(plan, state) {
  const listed = state.rows.map((row) => ({ clusterId: row.clusterId, finalStatus: row.finalStatus, severity: row.severity, title: state.clusters.find((c) => c.id === row.clusterId)?.primaryTitle || row.clusterId, files: [...new Set((state.clusters.find((c) => c.id === row.clusterId)?.anchors || []).map((anchor) => anchor.file))] }));
  const rawSummary = state.rows.length
    ? await boundedCall(plan.turnMs ?? DEFAULTS.debate.turnMs, plan.signal, (signal) => plan.summaryVoice({ rows: state.rows, clusters: listed, signal }))
    : rulesSummary(state.rows);
  const unavailable = !rawSummary || rawSummary.unavailable ? (rawSummary?.unavailable || 'no answer') : null;
  const allGaps = [...(state.coverageGaps || []), ...(state.gaps || []), ...(state.missing || [])];
  const baseSummary = unavailable
    ? rulesSummary(state.rows, { gaps: allGaps, failedSurfaces: plan.failedSurfaces, partialSurfaces: plan.partialSurfaces, fallbackReason: unavailable })
    : rawSummary;
  const extraLimitations = !unavailable ? limitationClause(state.rows, { gaps: allGaps, failedSurfaces: plan.failedSurfaces, partialSurfaces: plan.partialSurfaces }) : '';
  const summary = extraLimitations && !String(baseSummary.executiveSummary || '').includes('Open questions and limitations:')
    ? { ...baseSummary, executiveSummary: `${baseSummary.executiveSummary} ${extraLimitations}` }
    : baseSummary;
  const general = composeGeneralReview({
    rows: state.rows, clusters: state.clusters, gaps: allGaps, scope: plan.scope, failedSurfaces: plan.failedSurfaces,
    reviewers: plan.reviewers, usage: plan.usage, summary,
    methodology: { ...plan.methodology, judgeAssignment: state.rows.map((row) => {
      const retried = state.trace.some((entry) => entry.template === 'judge-retry' && entry.clusterId === row.clusterId);
      return `${row.clusterId}: ${row.judge.reviewerId}${row.judge.alternate ? ' (alternate)' : ''}${retried ? ' (retried)' : ''}`;
    }) },
  });
  writeJson(plan.out, 'general-review.json', general);
  writeText(plan.out, 'general-review.md', generalReviewMarkdown(general));
  state.trace.push({ phase: 'general-review', template: 'general-review', stop: unavailable ? 'fallback' : 'submitted', ...(unavailable ? { reason: unavailable } : {}) });
  writeTrace(plan.out, state.trace);
  if (unavailable) throw stageError('general_review_unavailable', `general_review_unavailable: ${unavailable}`);
  return general;
}

// All three stages in one call, for the host demo and the golden eval. Missing answers are returned, not thrown.
export async function runDebateStages(plan) {
  const adjudicated = await adjudicateStage(plan, await debateStage(plan));
  const general = await generalReviewStage(plan, adjudicated);
  return { ...adjudicated, general };
}

// Host demo hook: debate the scripted submissions already in `out` (meta.json + auditors/) over the fixture source.
export function runOfflineDebate(out, sourceRoot, options = {}) {
  return runDebateStages(offlinePlan({ out, sourceRoot, ...options }));
}
