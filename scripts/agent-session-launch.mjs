import { families } from './reviewer-families.mjs';
export { ADAPTER_PINS, sessionEnvironment, runtimeAdapter } from './provider-cli.mjs';

// Dispatcher: the family registry owns every launch branch. Callers that pass only `agent`
// (tests, check-agents) get the `cli` family with the provider named by `agent`.
export function buildSessionLaunch({ agent, model, family = 'cli', provider = agent, workDir, bridgeArgs, legacyConversationId, env = process.env, runtimeAdapter: adapterFor }) {
  return families.launch({ id: agent, family, provider, model }, { workDir, bridgeArgs, legacyConversationId, env, ...(adapterFor ? { runtimeAdapter: adapterFor } : {}) });
}
