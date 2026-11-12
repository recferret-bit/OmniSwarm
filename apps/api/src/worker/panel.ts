import { accountPresetProvider, specFor } from '@omniswarm/schemas/providers';

// The production review panel. GLM on Z.AI is the orchestrator. Qwen on
// OpenRouter reviews with it. Opus 5.5, Sol 6.1, Argon 4 and Grok 4.7 are
// optional OpenRouter reviewers the account can add.
export const PANEL_EXTRAS = ['opus', 'sol', 'argon', 'grok'] as const;
export type PanelExtra = (typeof PANEL_EXTRAS)[number];

export const PANEL_MODELS: Record<PanelExtra | 'zai' | 'qwen', { label: string; spec: string }> = {
  zai: { label: 'GLM 5.3 (Z.AI)', spec: 'key:zai:glm-5.3' },
  qwen: { label: 'Qwen (OpenRouter)', spec: 'openrouter:qwen/qwen3.8-max-0902' },
  opus: { label: 'Opus 5.5', spec: 'openrouter:anthropic/claude-opus-5.5' },
  sol: { label: 'Sol 6.1', spec: 'openrouter:openai/gpt-6.1-sol' },
  argon: { label: 'Argon 4', spec: 'openrouter:google/gemini-4-argon' },
  grok: { label: 'Grok 4.7', spec: 'openrouter:x-ai/grok-4.7' },
};

const EXTRA_SET = new Set<string>(PANEL_EXTRAS);

/** `panel` plus the extras, in catalog order. Defaults are always included. */
export function panelPresetName(extras: readonly string[]): string {
  const unknown = extras.filter((id) => !EXTRA_SET.has(id));
  if (unknown.length) throw new Error(`unknown model ${unknown[0]}`);
  const selected = PANEL_EXTRAS.filter((id) => extras.includes(id));
  return ['panel', ...selected].join('-');
}

export function isPanelPreset(name: string): boolean {
  return name === 'panel' || name.startsWith('panel-');
}

export function panelSpecs(name: string): { reviewers: string[]; orchestrator: string; alternateJudge: string } {
  if (!isPanelPreset(name)) throw new Error(`preset ${name} is not a panel`);
  const extras = name === 'panel' ? [] : name.slice('panel-'.length).split('-');
  if (extras.some((id) => !EXTRA_SET.has(id))) throw new Error(`preset ${name} names an unknown model`);
  const ordered = PANEL_EXTRAS.filter((id) => extras.includes(id));
  if (ordered.join('-') !== extras.join('-')) throw new Error(`preset ${name} is out of order`);
  const reviewers = ['zai', 'qwen', ...ordered].map((id) => PANEL_MODELS[id as PanelExtra | 'zai' | 'qwen'].spec);
  return { reviewers, orchestrator: PANEL_MODELS.zai.spec, alternateJudge: PANEL_MODELS.qwen.spec };
}

/** Config file the engine reads for one panel job (OMNI_RUN_CONFIG). */
export function panelConfigDocument(name: string): Record<string, unknown> {
  const { reviewers, orchestrator, alternateJudge } = panelSpecs(name);
  return {
    reviewers,
    orchestrator,
    presets: {
      [name]: { reviewers, orchestrator, alternateJudge, assign: 'matrix', passes: 2, toolBudget: 30, maxCostUsd: 25 },
    },
  };
}

/**
 * Config for a review on an account's own provider key (preset `account-<provider>`, today `account-nearai`).
 * The first model orchestrates and every model reviews. A second model is the alternate judge; with one model
 * there is none. `maxCostUsd` only binds when the provider reports usage.cost or omniswarm.config.json has
 * prices.<provider>.<model> (engine applyPrice); otherwise spend is not bounded by it.
 */
export function accountConfigDocument(preset: string, models: readonly string[]): Record<string, unknown> {
  const provider = accountPresetProvider(preset);
  if (!provider) throw new Error(`preset ${preset} is not an account preset`);
  if (models.length === 0) throw new Error('an account review needs at least one model');
  const reviewers = models.map((model) => specFor(provider, model));
  const orchestrator = reviewers[0] as string;
  const alternateJudge = reviewers[1];
  return {
    reviewers,
    orchestrator,
    presets: {
      [preset]: {
        reviewers, orchestrator, ...(alternateJudge ? { alternateJudge } : {}), assign: 'matrix', passes: 2, toolBudget: 30, maxCostUsd: 25,
      },
    },
  };
}

/** Every reviewer spec a panel or account job runs (orchestrator and alternate judge included). */
export function jobSpecs(preset: string, models: readonly string[] | null): string[] {
  if (isPanelPreset(preset)) {
    const panel = panelSpecs(preset);
    return [panel.orchestrator, panel.alternateJudge, ...panel.reviewers];
  }
  if (accountPresetProvider(preset)) return (models ?? []).map((model) => specFor(accountPresetProvider(preset) as string, model));
  return [];
}
