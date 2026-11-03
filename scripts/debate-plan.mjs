// What the debate, adjudicate and general-review phases run on. The input is always the run's own committed
// claims. Scripted reviewers speak through their scripted strategy; every other reviewer speaks through a bridge
// session. The scripted judge runs only on OmniSwarm's own fixtures (demo-fixture, eval/golden).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadClaims } from './debate-claims.mjs';
import { sourceReader } from './debate-citations.mjs';
import { scriptedVoice } from './debate-scripted.mjs';
import { bridgeJudge, bridgeSummary, bridgeVoice } from './debate-voices.mjs';
import { rulesSummary } from './debate-general-review.mjs';
import { recommendedOrchestrator, selectSurfaces } from './reviewer-plan.mjs';
import { formatReviewerSpec } from './reviewer-registry.mjs';
import { readJsonOr } from './report-util-files.mjs';
import { DEFAULTS } from './run-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = [path.join(ROOT, 'scripts', 'demo-fixture'), path.join(ROOT, 'eval', 'golden')];
const DEBATE_DEFAULTS = DEFAULTS.debate;

export function stageError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isFixtureTarget(target) {
  if (!target) return false;
  const real = fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target);
  return FIXTURES.some((root) => real === root || real.startsWith(`${root}${path.sep}`));
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
    return [reviewer.id, { calls: rows.reduce((n, row) => n + (Number(row.calls) || 0), 0), cost: Math.round(rows.reduce((n, row) => n + (Number(row.cost) || 0), 0) * 1000) / 1000 }];
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

// A plan with no bridge: scripted reviewers and the scripted judge only, on an OmniSwarm fixture. Used by the
// host demo (claims loaded from its report dir) and the golden eval (claims passed in).
export function offlinePlan({ out, sourceRoot, claims, controls, reviewers, rounds = DEBATE_DEFAULTS.rounds, scope = ['S1'], manifest = null }) {
  if (!isFixtureTarget(sourceRoot)) throw stageError('scripted_judge_demo_only', 'scripted_judge_demo_only: the offline debate runs only on OmniSwarm fixtures');
  if (!claims) ({ claims, controls, reviewers } = loadClaims(out));
  const orchestrator = { id: 'scripted-judge', family: 'scripted', provider: 'judge', vendor: 'scripted', model: 'judge' };
  const reader = sourceReader(sourceRoot, manifest);
  return {
    out, reader, claims, reviewers, orchestrator, alternate: null, rounds, maxClusters: DEBATE_DEFAULTS.maxClusters, seed: 1,
    vendors: new Map(reviewers.map((r) => [r.id, r.vendor])),
    voices: voicesFor(reviewers, { claims, controls, reader, bridge: null }),
    judgeVoice: () => async () => ({ unavailable: 'no_bridge_offline' }),
    summaryVoice: async ({ rows }) => rulesSummary(rows),
    scope, failedSurfaces: new Set(), usage: usageOf(out, reviewers),
    methodology: { reviewers: reviewers.map((r) => r.id), orchestrator: 'scripted:judge', passes: 1, toolBudget: 40, debateRounds: rounds },
  };
}

// The plan for one orchestrated run, or null when no orchestrator was asked for.
export function debatePlan(ctx, env = process.env) {
  const orchestrator = resolveOrchestrator(ctx.request?.orchestrator, env);
  if (!orchestrator) return null;
  if (orchestrator.family === 'scripted' && !isFixtureTarget(ctx.request?.target)) throw stageError('scripted_judge_demo_only', 'scripted_judge_demo_only: the scripted judge runs only on OmniSwarm fixtures');
  const debate = { ...DEBATE_DEFAULTS, ...(ctx.budgets?.debate || {}) };
  const reader = sourceReader(ctx.request.target, readJsonOr(ctx.output, 'source-manifest.json', null));
  const { claims, controls, reviewers: metaReviewers } = loadClaims(ctx.output);
  const reviewers = ctx.reviewers?.length ? ctx.reviewers : metaReviewers;
  return {
    out: ctx.output, reader, claims, reviewers, orchestrator, alternate: ctx.request.alternateJudge || null,
    rounds: debate.rounds, maxClusters: debate.maxClusters, seed: 1,
    vendors: new Map(reviewers.map((r) => [r.id, r.vendor])),
    voices: voicesFor(reviewers, { claims, controls, reader, bridge: ctx, budget: debate.toolBudget }),
    judgeVoice: (choice) => bridgeJudge(ctx, choice.reviewer, debate.toolBudget),
    summaryVoice: orchestrator.family === 'scripted' ? async ({ rows }) => rulesSummary(rows) : bridgeSummary(ctx, orchestrator),
    scope: selectSurfaces(ctx.surfaceArg || 'all').map((s) => s.code),
    failedSurfaces: new Set((ctx.jobs || []).filter((job) => job.state === 'failed').map((job) => job.surface?.code).filter(Boolean)),
    usage: usageOf(ctx.output, reviewers),
    methodology: { reviewers: reviewers.map((r) => r.id), orchestrator: formatReviewerSpec(orchestrator), passes: ctx.budgets?.passes || 1, toolBudget: ctx.budgets?.toolBudget || 40, debateRounds: debate.rounds },
  };
}
