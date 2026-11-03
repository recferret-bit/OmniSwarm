// The `openrouter` family: one OpenRouter key, the shared tool loop, data_collection denied.
import { buildApiLaunch } from './provider-api-launch.mjs';
import { presetFor } from './provider-openai-compat.mjs';

const preset = presetFor('openrouter');

function launch(reviewer, ctx) {
  return buildApiLaunch(reviewer, ctx, preset);
}

export const family = {
  name: 'openrouter',
  transport: 'api-acp',
  providers: { openrouter: { installed: () => true } },
  installed: () => true,
  available: (_reviewer, env = process.env) => Boolean(env.OPENROUTER_API_KEY),
  launch,
  envAllowlist: () => preset.envAllowlist,
  fingerprintEnv: () => preset.keyEnv,
};
