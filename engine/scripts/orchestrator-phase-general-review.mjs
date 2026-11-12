// general-review.{json,md} from the adjudication (ORCHESTRATION 4.4).
// OMNI_FAULT=general-review is the W06 fault seam: a coded throw recorded as a stage failure.
import { stageError } from './debate-plan.mjs';
import { generalReviewStage } from './debate-run.mjs';
import { servedModels } from './orchestrator-review.mjs';
import { loadAuditors } from './report-contract.mjs';
import { buildIncompletionNotes } from './report-incompletion.mjs';
import { readJsonOr } from './report-util-files.mjs';

export const phase = {
  name: 'general-review',
  async run(ctx) {
    if (!ctx.debate?.state?.rows) return;
    if (process.env.OMNI_FAULT === 'general-review') throw stageError('general-review', 'injected fault: general-review');
    if (ctx.output && !Array.isArray(ctx.debate.plan.incompletionNotes)) {
      try {
        const diskMeta = readJsonOr(ctx.output, 'meta.json', null);
        if (diskMeta && typeof diskMeta === 'object' && !Array.isArray(diskMeta)) {
          const served = Array.isArray(ctx.jobs) ? servedModels(ctx.jobs) : {};
          const liveMeta = {
            ...diskMeta,
            ...(Array.isArray(diskMeta.reviewers)
              ? { reviewers: diskMeta.reviewers.map((r) => (served[r.id] ? { ...r, servedModel: served[r.id] } : r)) }
              : {}),
            finalized: true,
            debatesCompleted: true,
            ...(ctx.workerExits ? { workerExits: { ...(diskMeta.workerExits || {}), ...ctx.workerExits } } : {}),
            ...(ctx.crosscheckExits ? { crosscheckExits: { ...(diskMeta.crosscheckExits || {}), ...ctx.crosscheckExits } } : {}),
            stageFailures: [...new Set([...(diskMeta.stageFailures || []), ...(ctx.stageFailures || [])])],
            providerFailures: { ...(diskMeta.providerFailures || {}), ...(ctx.providerFailures || {}) },
          };
          const { meta, health } = loadAuditors(ctx.output, { meta: liveMeta });
          ctx.debate.plan.incompletionNotes = buildIncompletionNotes(ctx.output, { meta, health });
        }
      } catch { /* non-fatal if report dir is minimal test fixture */ }
    }
    await generalReviewStage(ctx.debate.plan, ctx.debate.state);
  },
};
