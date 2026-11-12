// Debate rounds over the run's own clusters (ORCHESTRATION 4.1-4.2). No orchestrator, no debate.
// OMNI_FAULT=debate-round-2 is the W06 fault seam: a coded throw that the phase runner records as a stage failure.
import { debatePlan, stageError } from './debate-plan.mjs';
import { debateStage } from './debate-run.mjs';

export const phase = {
  name: 'debate',
  async run(ctx) {
    if (ctx.request?.pipelineMode === 'stage-1' || ctx.request?.pipelineMode === 'step-by-step') return;
    const plan = debatePlan(ctx);
    if (!plan) return;
    if (process.env.OMNI_FAULT === 'debate-round-2') throw stageError('debate-round-2', 'injected fault: debate-round-2');
    ctx.debate = { plan, state: await debateStage(plan) };
  },
};
