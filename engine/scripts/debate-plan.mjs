// What the debate, adjudicate and general-review phases run on. The input is always the run's own committed
// claims. Scripted reviewers speak through their scripted strategy; every other reviewer speaks through a bridge
// session. The scripted judge runs only on OmniSwarm's own fixtures (demo-fixture, eval/golden).
import fs from 'node:fs';
import path from 'node:path';
import { loadClaims } from './debate-claims.mjs';
import { crosscheckPrior } from './debate-crosscheck.mjs';
import { sourceReader } from './debate-citations.mjs';
import { isFixtureTarget, SCRIPTED_JUDGE_REFUSAL } from './debate-fixtures.mjs';
import { scriptedVoice } from './debate-scripted.mjs';
import { bridgeJudge, bridgeSummary, bridgeVoice } from './debate-voices.mjs';
import { rulesSummary } from './debate-general-review.mjs';
import { recommendedOrchestrator, selectSurfaces } from './reviewer-plan.mjs';
import { formatReviewerSpec } from './reviewer-registry.mjs';
import { readJsonOr } from './report-util-files.mjs';
import { peerReviewedSeverities } from './verify-and-adjudicate.mjs';
import { DEFAULTS } from './run-config.mjs';

const DEBATE_DEFAULTS = DEFAULTS.debate;

export function stageError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveOrchestrator(requested, env = process.env) {
  if (!requested) return null;
  if (requested !== 'recommended') return requested;
  const { reviewer, reason } = recommendedOrchestrator({ env });
  if (!reviewer) throw stageError('no_orchestrator_available', `no orchestrator available: ${reason}`);
  return reviewer;
}

function usageOf(out, reviewers) {
  return new Map(reviewers.map((reviewer) => {
    const dir = path.join(out, 'harness', 'usage', reviewer.id);
    const rows = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJsonOr(out, `harness/usage/${reviewer.id}/${f}`, {})) : [];
    // A cost is known only when some pass reported or estimated one (CLI subscriptions and scripted runs do not).
    const priced = rows.filter((row) => ['reported', 'estimated'].includes(row.costSource));
    const cost = priced.length ? Math.round(priced.reduce((n, row) => n + (Number(row.cost) || 0), 0) * 1000) / 1000 : null;
    return [reviewer.id, { calls: rows.reduce((n, row) => n + (Number(row.calls) || 0), 0), cost }];
  }));
}

// Voices for every reviewer of the run. bridge: the orchestrator ctx (execute), or null offline.
function voicesFor(reviewers, { claims, controls, reader, bridge, budget }) {
  return new Map(reviewers.map((reviewer) => {
    if (reviewer.family === 'scripted') {
      return [reviewer.id, scriptedVoice(reviewer.provider, { findings: claims.filter((c) => c.reviewerId === reviewer.id), controls: controls.get(reviewer.id) || [], reader })];
    }
    if (!bridge) return [reviewer.id, async () => ({ unavailable: 'no_bridge_offline' })];
    return [reviewer.id, bridgeVoice(bridge, reviewer, budget)];
  }));
}

function partialSurfacesOf(ctx) {
  const targetPasses = ctx.budgets?.passes || 1;
  const notes = [];
  for (const job of ctx.jobs || []) {
    if (job.state === 'collected' && Number.isInteger(job.passesCompleted) && job.passesCompleted < targetPasses) {
      notes.push(`${job.name} (${job.passesCompleted}/${targetPasses} passes)`);
    }
  }
  const health = readJsonOr(ctx.output, 'harness/budget-health.json', null);
  for (const stop of health?.budgetStops || []) {
    if (stop.restored || stop.submitted === false) {
      const label = stop.job || stop.reviewer;
      if (label && !notes.some((n) => n.startsWith(label))) notes.push(`${label} (pass ${stop.pass} ${stop.stop})`);
    }
  }
  for (const reviewer of ctx.reviewers || []) {
    const budget = readJsonOr(ctx.output, `harness/budget-${reviewer.id}.json`, null);
    for (const [key, rec] of Object.entries(budget?.passes || {})) {
      if (rec?.exhausted) {
        const label = `${reviewer.id}:${key}`;
        if (!notes.some((n) => n.includes(reviewer.id) && n.includes(key.split(':')[0]))) notes.push(`${label} (budget exhausted)`);
      }
    }
  }
  return notes;
}

// A plan with no bridge: scripted reviewers and the scripted judge only, on an OmniSwarm fixture. Used by the
// host demo (claims loaded from its report dir) and the golden eval (claims passed in).
export function offlinePlan({ out, sourceRoot, claims, controls, reviewers, rounds = DEBATE_DEFAULTS.rounds, scope = ['S1'], manifest = null, maxClusters = DEBATE_DEFAULTS.maxClusters }) {
  if (!isFixtureTarget(sourceRoot)) throw stageError(SCRIPTED_JUDGE_REFUSAL, `${SCRIPTED_JUDGE_REFUSAL}: the offline debate runs only on OmniSwarm fixtures`);
  const fromReport = !claims;
  if (fromReport) ({ claims, controls, reviewers } = loadClaims(out));
  const orchestrator = { id: 'scripted-judge', family: 'scripted', provider: 'judge', vendor: 'scripted', model: 'judge' };
  const reader = sourceReader(sourceRoot, manifest);
  return {
    out, reader, claims, reviewers, orchestrator, alternate: null, rounds, maxClusters,
    severities: fromReport ? peerReviewedSeverities(out) : null,
    turnMs: DEBATE_DEFAULTS.turnMs, phaseMs: DEBATE_DEFAULTS.phaseMs, seed: 1,
    vendors: new Map(reviewers.map((r) => [r.id, r.vendor])),
    voices: voicesFor(reviewers, { claims, controls, reader, bridge: null }),
    judgeVoice: () => async () => ({ unavailable: 'no_bridge_offline' }),
    summaryVoice: async ({ rows }) => rulesSummary(rows),
    scope, failedSurfaces: new Set(), partialSurfaces: [], usage: usageOf(out, reviewers),
    methodology: { reviewers: reviewers.map((r) => r.id), orchestrator: 'scripted:judge', passes: 1, toolBudget: 40, debateRounds: rounds },
  };
}

// The plan for one orchestrated run, or null when no orchestrator was asked for.
export function debatePlan(ctx, env = process.env) {
  const orchestrator = resolveOrchestrator(ctx.request?.orchestrator, env);
  if (!orchestrator) return null;
  if (orchestrator.family === 'scripted' && !isFixtureTarget(ctx.request?.target)) throw stageError(SCRIPTED_JUDGE_REFUSAL, `${SCRIPTED_JUDGE_REFUSAL}: the scripted judge runs only on OmniSwarm fixtures`);
  const debate = { ...DEBATE_DEFAULTS, ...(ctx.budgets?.debate || {}) };
  // Citations are checked against the sealed snapshot. Without its manifest the checker would read whatever is
  // on disk now, so a real target with no manifest stops here instead of debating unsealed source.
  const manifest = readJsonOr(ctx.output, 'source-manifest.json', null);
  if (!manifest && !isFixtureTarget(ctx.request?.target)) throw stageError('source_manifest_missing', 'source_manifest_missing: the debate needs source-manifest.json to check citations against the sealed snapshot');
  const reader = sourceReader(ctx.request.target, manifest);
  const { claims, controls, reviewers: metaReviewers } = loadClaims(ctx.output);
  const reviewers = ctx.reviewers?.length ? ctx.reviewers : metaReviewers;
  return {
    out: ctx.output, reader, claims, reviewers, orchestrator, alternate: ctx.request.alternateJudge || null,
    rounds: debate.rounds, maxClusters: debate.maxClusters, turnMs: debate.turnMs, phaseMs: debate.phaseMs,
    // One severity per cluster: the debate starts from the severity the report gives it after peer review.
    severities: peerReviewedSeverities(ctx.output),
    signal: ctx.cancellation?.signal, seed: 1,
    prior: crosscheckPrior(ctx.output, reader),
    onProgress: ctx.progress ? (name, done, total) => ctx.progress.counter(name, done, total) : null,
    vendors: new Map(reviewers.map((r) => [r.id, r.vendor])),
    voices: voicesFor(reviewers, { claims, controls, reader, bridge: ctx, budget: debate.toolBudget }),
    judgeVoice: (choice) => bridgeJudge(ctx, choice.reviewer, debate.toolBudget),
    summaryVoice: orchestrator.family === 'scripted' ? async ({ rows }) => rulesSummary(rows) : bridgeSummary(ctx, orchestrator, debate.toolBudget),
    scope: selectSurfaces(ctx.surfaceArg || 'all').map((s) => s.code),
    failedSurfaces: new Set((ctx.jobs || []).filter((job) => job.state && job.state !== 'collected').map((job) => job.surface?.code).filter(Boolean)),
    partialSurfaces: partialSurfacesOf(ctx),
    usage: usageOf(ctx.output, reviewers),
    methodology: { reviewers: reviewers.map((r) => r.id), orchestrator: formatReviewerSpec(orchestrator), passes: ctx.budgets?.passes || 1, toolBudget: ctx.budgets?.toolBudget || 40, debateRounds: debate.rounds },
  };
}
