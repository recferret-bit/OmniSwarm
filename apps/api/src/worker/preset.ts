// Hosted preset resolution (W09-07, OD-04). The engine reads presets from omniswarm.config.json; the
// worker reads the same file to learn which provider keys the preset's reviewers need, and refuses a
// preset that would run a personal CLI subscription (`cli:*`) or an orchestrator it cannot vet.
import fs from 'node:fs';
import { envForSpec, providerOfSpec } from '@omniswarm/schemas/providers';
import { AppError } from '../shared/errors.ts';
import { isPanelPreset, panelSpecs } from './panel.ts';

/**
 * Provider variables per reviewer spec come from the provider catalog (packages/schemas/providers.mjs). Only
 * API providers run hosted: `cli:*` (a personal CLI subscription) and `scripted` (OmniSwarm's own fixtures
 * only, engine debate-plan.mjs `scripted_judge_demo_only`) are refused on a requester's repository.
 */
function hostedEnv(spec: string): string[] | null {
  const provider = providerOfSpec(spec);
  if (!provider || provider === 'local') return null;
  return envForSpec(spec);
}

function refuse(message: string): never {
  throw new AppError('PRESET_NOT_ALLOWED', message);
}

export interface ResolvedPreset { name: string; envNames: string[] }

/** Map one preset's reviewer specs (plus orchestrator and alternate judge) to the env names they need. */
export function presetEnv(name: string, specs: string[]): ResolvedPreset {
  const names = new Set<string>();
  for (const spec of specs) {
    if (typeof spec !== 'string' || spec === '') refuse(`preset ${name} has an empty reviewer`);
    const env = hostedEnv(spec);
    if (!env) refuse(`preset ${name} uses ${spec.split(':')[0]}, which the hosted service does not run`);
    env.forEach((variable) => names.add(variable));
  }
  return { name, envNames: [...names].sort() };
}

export function resolvePreset(configPath: string, name: string): ResolvedPreset {
  if (isPanelPreset(name)) {
    const panel = panelSpecs(name);
    return presetEnv(name, [panel.orchestrator, panel.alternateJudge, ...panel.reviewers]);
  }
  if (!fs.existsSync(configPath)) refuse(`engine config ${configPath} is missing; preset ${name} cannot be resolved`);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { presets?: Record<string, Record<string, unknown>> };
  const preset = config.presets?.[name];
  if (!preset) refuse(`preset ${name} is not defined in ${configPath}`);
  const specs = [...(Array.isArray(preset.reviewers) ? preset.reviewers : [])];
  if (!specs.length) refuse(`preset ${name} has no reviewers`);
  for (const key of ['orchestrator', 'alternateJudge']) {
    const value = preset[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value === 'recommended') refuse(`preset ${name} must name its ${key} explicitly`);
    specs.push(value);
  }
  return presetEnv(name, specs as string[]);
}
