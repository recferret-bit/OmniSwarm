// Judge every debated cluster (ORCHESTRATION 4.3). Runs only after a debate phase that finished.
import fs from 'node:fs';
import path from 'node:path';
import { adjudicateStage, missingAnswersError } from './debate-run.mjs';
import { saveDebateState } from './orchestrator-pipeline.mjs';

export const phase = {
  name: 'adjudicate',
  async run(ctx) {
    if (!ctx.debate?.state) return;
    ctx.debate.state = await adjudicateStage(ctx.debate.plan, ctx.debate.state);
    if (ctx.request?.pipelineMode || fs.existsSync(path.join(ctx.output, 'evidence'))) {
      saveDebateState(ctx.output, ctx.debate.state, ctx.debate?.plan?.rounds);
    }
    if (ctx.debate.state.missing.length) throw missingAnswersError(ctx.debate.state.missing);
  },
};
