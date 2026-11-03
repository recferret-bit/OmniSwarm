// Judge every debated cluster (ORCHESTRATION 4.3). Runs only after a debate phase that finished.
import { adjudicateStage, missingAnswersError } from './debate-run.mjs';

export const phase = {
  name: 'adjudicate',
  async run(ctx) {
    if (!ctx.debate?.state) return;
    ctx.debate.state = await adjudicateStage(ctx.debate.plan, ctx.debate.state);
    if (ctx.debate.state.missing.length) throw missingAnswersError(ctx.debate.state.missing);
  },
};
