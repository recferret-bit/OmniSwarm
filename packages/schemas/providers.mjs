// The LLM provider catalog: the one place that says which model providers OmniSwarm can use and how each
// one is reached. Public descriptors (name, spec prefix, key sources, data policy) live in
// providers-public.mjs, which the browser may import; this file adds the server-only wiring (key variables,
// base URLs, request bodies) and is read by the engine (provider-openai-compat.mjs, the family files,
// check-agents, local-cli) and the intake API (key stores, the engine env allow-list, preset resolution).
// Adding or swapping a provider is one entry in each half plus, for a new spec family, one engine family file.
//
// Providers are separate from each other: each has its own key variable, base URL and request body, and a
// reviewer process receives only its own provider's variables. The harness, the MCP bridge, the sandbox
// and the reviewer skill never depend on which provider a reviewer uses.
//
// Wiring fields (openai-chat providers):
//   baseUrl       fixed API base URL
//   baseUrlEnv    optional operator override of baseUrl. Never set for a provider whose key can come from an
//                 account, so a user's key cannot be pointed at another host.
//   keyEnv        the variable holding the key; envAllowlist is every variable its reviewer process receives
//   extraBody     fields merged into every chat-completions request
//   headers       extra request headers
import {
  ACCOUNT_PRESET_PREFIX, MODEL_ID_PATTERN, PUBLIC_PROVIDERS, accountPresetName, accountPresetProvider, isModelId,
} from './providers-public.mjs';

export { ACCOUNT_PRESET_PREFIX, MODEL_ID_PATTERN, accountPresetName, accountPresetProvider, isModelId };

const WIRING = Object.freeze({
  local: { keyEnv: null, envAllowlist: [] },
  zai: {
    baseUrl: 'https://api.z.ai/api/paas/v4',
    baseUrlEnv: 'ZAI_BASE_URL',
    keyEnv: 'ZAI_API_KEY',
    envAllowlist: ['ZAI_API_KEY', 'ZAI_BASE_URL'],
    extraBody: { reasoning_effort: 'high' },
    headers: {},
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEnv: null,
    keyEnv: 'OPENROUTER_API_KEY',
    envAllowlist: ['OPENROUTER_API_KEY'],
    extraBody: { provider: { require_parameters: true, data_collection: 'deny' } },
    headers: { 'HTTP-Referer': 'https://omniswarm.dev', 'X-OpenRouter-Title': 'OmniSwarm' },
  },
  nearai: {
    baseUrl: 'https://cloud-api.near.ai/v1',
    baseUrlEnv: null,
    keyEnv: 'NEARAI_API_KEY',
    envAllowlist: ['NEARAI_API_KEY'],
    extraBody: {},
    headers: {},
  },
});

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

export const PROVIDERS = Object.freeze(PUBLIC_PROVIDERS.map((provider) => {
  const wiring = WIRING[provider.id];
  if (!wiring) throw new Error(`provider ${provider.id} has no wiring in providers.mjs`);
  return deepFreeze({ ...provider, ...structuredClone(wiring) });
}));

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function providerById(id) {
  return BY_ID.get(id) ?? null;
}

/** Providers reached through OmniSwarm's chat-completions tool loop. */
export function apiProviders() {
  return PROVIDERS.filter((provider) => provider.transport === 'openai-chat');
}

/** Providers whose key a signed-in account may save for its own reviews. */
export function accountProviders() {
  return PROVIDERS.filter((provider) => provider.keySources.includes('account'));
}

/** Providers whose key the operator saves on the admin page. */
export function adminProviders() {
  return PROVIDERS.filter((provider) => provider.keySources.includes('admin-page'));
}

/** Every key-related variable of every API provider. Nothing else of this kind may reach the engine. */
export function providerEnvNames() {
  return [...new Set(apiProviders().flatMap((provider) => provider.envAllowlist))].sort();
}

/** `nearai` + `deepseek-ai/DeepSeek-V4` -> `nearai:deepseek-ai/DeepSeek-V4`. Throws on an unknown provider or a bad id. */
export function specFor(providerId, model) {
  const provider = providerById(providerId);
  if (!provider || provider.transport !== 'openai-chat') throw new Error(`unknown API provider ${providerId}`);
  if (!isModelId(model)) throw new Error(`invalid model id ${JSON.stringify(model)}`);
  return `${provider.specPrefix}${model}`;
}

// CLI reviewers that borrow an API provider's key (cli:claude-zai uses the Z.AI key through Claude Code).
const CLI_KEY_BORROWERS = Object.freeze({ 'claude-zai': 'zai' });

/** The provider a reviewer spec runs on: `local`, an API provider id, or null (scripted, unknown). */
export function providerOfSpec(spec) {
  const text = String(spec || '').replace(/#.*$/, '');
  if (text.startsWith('cli:')) return 'local';
  for (const provider of apiProviders()) if (text.startsWith(provider.specPrefix)) return provider.id;
  return null;
}

/** Variables the process running this spec may need (the borrowed key of a CLI like claude-zai included). */
export function envForSpec(spec) {
  const text = String(spec || '').replace(/#.*$/, '');
  if (text.startsWith('cli:')) {
    const borrowed = CLI_KEY_BORROWERS[text.split(':')[1] ?? ''];
    return borrowed ? [...providerById(borrowed).envAllowlist] : [];
  }
  const id = providerOfSpec(text);
  return id ? [...providerById(id).envAllowlist] : [];
}
