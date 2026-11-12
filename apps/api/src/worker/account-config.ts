import { accountPresetProvider, specFor } from '@omniswarm/schemas/providers';

export interface RunOptions {
  pipelineMode?: 'full' | 'step-by-step' | 'stage-1';
  concurrency?: number;
}

/**
 * Config for a review on an account's own provider key (preset `account-<provider>`, today `account-nearai`).
 * The first model orchestrates and every model reviews. A second model is the alternate judge; with one model
 * there is none. `maxCostUsd` only binds when the provider reports usage.cost or omniswarm.config.json has
 * prices.<provider>.<model> (engine applyPrice); otherwise spend is not bounded by it.
 */
export function accountConfigDocument(preset: string, models: readonly string[], opts?: RunOptions): Record<string, unknown> {
  const provider = accountPresetProvider(preset);
  if (!provider) throw new Error(`preset ${preset} is not an account preset`);
  if (models.length === 0) throw new Error('an account review needs at least one model');
  const reviewers = models.map((model) => specFor(provider, model));
  const orchestrator = reviewers[0] as string;
  const alternateJudge = reviewers[1];
  const pipelineExtra = opts?.pipelineMode && opts.pipelineMode !== 'full' ? { pipelineMode: opts.pipelineMode } : {};
  const resolvedConcurrency = opts?.concurrency ?? 3;
  const concurrencyExtra = resolvedConcurrency > 1 ? { concurrency: resolvedConcurrency } : {};
  return {
    reviewers,
    orchestrator,
    ...pipelineExtra,
    ...concurrencyExtra,
    presets: {
      [preset]: {
        reviewers, orchestrator, ...(alternateJudge ? { alternateJudge } : {}), assign: 'matrix', passes: 2, toolBudget: 30, maxCostUsd: 25,
        ...pipelineExtra,
        ...concurrencyExtra,
      },
    },
  };
}
