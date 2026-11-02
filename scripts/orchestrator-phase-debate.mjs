// Replaces the debate stub. Scripted runs write debate/ here; other runs leave the stub no-op unless asked.
import { runGolden } from './debate-run.mjs';

export const phase = {
  name: 'debate',
  after: 'crosscheck',
  optional: true,
  async run(ctx) {
    const fault = process.env.OMNI_FAULT;
    if (!ctx.request?.orchestrator && !fault) return;
    const source = ctx.request?.target;
    if (!source) return;
    try { runGolden(source, ctx.output, { rounds: ctx.budgets?.debate?.rounds ?? 2, fault }); }
    catch (error) {
      if (ctx.stageFailures && !ctx.stageFailures.includes(error.code || 'debate')) ctx.stageFailures.push(error.code || 'debate');
      throw error;
    }
  },
};
