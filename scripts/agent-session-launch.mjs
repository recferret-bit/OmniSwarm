import { families } from './reviewer-families.mjs';
export { ADAPTER_PINS, sessionEnvironment, runtimeAdapter } from './provider-cli.mjs';

// Dispatcher: the family registry owns every launch branch. Callers that pass only `agent`
// (tests, check-agents) get the `cli` family with the provider named by `agent`.
export function buildSessionLaunch({ agent, role, model, family = 'cli', provider = agent, workDir, bridgeArgs, legacyConversationId, env = process.env, runtimeAdapter: adapterFor, maxTurns, maxCostUsd, toolBudget, prices }) {
  return families.launch({ id: agent, family, provider, model }, { role, workDir, bridgeArgs, legacyConversationId, env, maxTurns, maxCostUsd, toolBudget, prices, ...(adapterFor ? { runtimeAdapter: adapterFor } : {}) });
}
