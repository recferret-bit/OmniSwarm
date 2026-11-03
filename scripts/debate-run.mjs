// The three debate stages over a plan from debate-plan.mjs. Each stage writes its files under debate/ (or
// general-review.*) and returns state for the next. A stage that cannot finish throws a coded error; the phase
// runner records it in meta.stageFailures and the report shows INCOMPLETE with every per-model finding intact.
import { buildClusters } from './debate-cluster.mjs';
import { runRounds } from './debate-rounds.mjs';
import { adjudicateCluster, agreedAdjudication, pickJudge } from './debate-judge.mjs';
import { composeGeneralReview, generalReviewMarkdown, rulesSummary } from './debate-general-review.mjs';
import { offlinePlan, stageError } from './debate-plan.mjs';
import { validate } from '../packages/schemas/index.mjs';
import { writeJson, writeText } from './report-util-files.mjs';

const writeTrace = (out, rows) => writeText(out, 'debate/trace.jsonl', rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));

export async function debateStage(plan) {
  const built = buildClusters(plan.claims, { reader: plan.reader, maxClusters: plan.maxClusters });
  const names = [...plan.reviewers.flatMap((r) => [r.id, r.vendor, r.model])];
  const result = await runRounds({ out: plan.out, clusters: built.clusters, voices: plan.voices, vendors: plan.vendors, reader: plan.reader, rounds: plan.rounds, seed: plan.seed, names });
  const clusters = built.clusters.map((row) => (result.debated.has(row.id) ? { ...row, rounds: result.debated.get(row.id).rounds } : row));
  writeJson(plan.out, 'debate/clusters.json', { clusters, coverageGaps: built.coverageGaps });
  writeJson(plan.out, 'debate/anonymization.json', result.anonymization);
  writeJson(plan.out, 'debate/citations.json', result.citations);
  writeTrace(plan.out, result.trace);
  return { clusters, coverageGaps: built.coverageGaps, debated: result.debated, gaps: result.gaps, trace: result.trace };
}

export async function adjudicateStage(plan, state) {
  const rows = [];
  const gaps = [];
  for (const cluster of state.clusters) {
    if (cluster.status === 'CAPPED') continue;
    if (cluster.status === 'AGREED') { rows.push(agreedAdjudication(cluster)); continue; }
    const turns = state.debated.get(cluster.id)?.turns || [];
    const choice = pickJudge(cluster, plan);
    const { row, gap } = await adjudicateCluster(cluster, turns, choice, plan.judgeVoice);
    const check = validate('adjudication', row);
    if (!check.ok) throw stageError('adjudication_invalid', `adjudication for ${cluster.id} failed its schema: ${check.errors[0]}`);
    rows.push(row);
    if (gap) gaps.push(gap);
    state.trace.push({ phase: 'adjudicate', template: 'judge', clusterId: cluster.id, judge: row.judge.reviewerId, alternate: row.judge.alternate, stop: row.finalStatus });
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
  const listed = state.rows.map((row) => ({ clusterId: row.clusterId, finalStatus: row.finalStatus, severity: row.severity, title: state.clusters.find((c) => c.id === row.clusterId)?.primaryTitle || row.clusterId }));
  const summary = state.rows.length ? await plan.summaryVoice({ rows: state.rows, clusters: listed }) : rulesSummary(state.rows);
  if (!summary || summary.unavailable) throw stageError('general_review_unavailable', `general_review_unavailable: ${summary?.unavailable || 'no answer'}`);
  const general = composeGeneralReview({
    rows: state.rows, clusters: state.clusters, gaps: [...state.coverageGaps, ...state.gaps], scope: plan.scope, failedSurfaces: plan.failedSurfaces,
    reviewers: plan.reviewers, usage: plan.usage, summary,
    methodology: { ...plan.methodology, judgeAssignment: state.rows.map((row) => `${row.clusterId}: ${row.judge.reviewerId}${row.judge.alternate ? ' (alternate)' : ''}`) },
  });
  writeJson(plan.out, 'general-review.json', general);
  writeText(plan.out, 'general-review.md', generalReviewMarkdown(general));
  state.trace.push({ phase: 'general-review', template: 'general-review', stop: 'submitted' });
  writeTrace(plan.out, state.trace);
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
