// general-review.{json,md} from the adjudication (ORCHESTRATION 4.4).
// OMNI_FAULT=general-review is the W06 fault seam: a coded throw recorded as a stage failure.
import { stageError } from './debate-plan.mjs';
import { generalReviewStage } from './debate-run.mjs';

export const phase = {
  name: 'general-review',
  async run(ctx) {
    if (!ctx.debate?.state?.rows) return;
    if (process.env.OMNI_FAULT === 'general-review') throw stageError('general-review', 'injected fault: general-review');
    await generalReviewStage(ctx.debate.plan, ctx.debate.state);
  },
};
