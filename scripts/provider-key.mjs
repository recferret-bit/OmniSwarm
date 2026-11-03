// The `key` family: one direct provider key, OmniSwarm's tool loop, the same MCP bridge as a CLI reviewer.
import { SessionError } from './agent-rpc.mjs';
import { buildApiLaunch } from './provider-api-launch.mjs';
import { presetFor } from './provider-openai-compat.mjs';

const KNOWN = {
  zai: { installed: () => true },
  // Messages API and the other compat presets are H+ (W03-11, W03-05). Specs parse; launch waits.
  anthropic: { installed: () => false, wave: 'W03-11' },
  openai: { installed: () => false, wave: 'W03-05' },
  xai: { installed: () => false, wave: 'W03-05' },
  google: { installed: () => false, wave: 'W03-05' },
};

function launch(reviewer, ctx) {
  let preset;
  try { preset = presetFor(reviewer.provider); }
  catch { throw new SessionError('setup_error', `unknown provider ${reviewer.provider}`); }
  return buildApiLaunch(reviewer, ctx, preset);
}

export const family = {
  name: 'key',
  transport: 'api-acp',
  providers: KNOWN,
  installed: () => true,
  available: (reviewer, env = process.env) => {
    try { return Boolean(env[presetFor(reviewer.provider).keyEnv]); }
    catch { return false; }
  },
  launch,
  envAllowlist: (reviewer) => {
    try { return presetFor(reviewer.provider).envAllowlist; }
    catch { return []; }
  },
  fingerprintEnv: (reviewer) => {
    try { return presetFor(reviewer.provider).keyEnv; }
    catch { return null; }
  },
};
