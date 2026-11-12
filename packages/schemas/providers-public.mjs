// Public half of the LLM provider catalog: what a provider is called, how its reviewer specs are written,
// where its key may come from and what leaves the machine. Safe for the browser bundle: no key variable,
// base URL or request body is here. The server-only half (providers.mjs) imports this file and adds the
// wiring, so the two halves are one catalog. See docs/providers.md.
//
//   id            provider id (also the `provider` of a parsed `nearai` reviewer)
//   label         human name
//   transport     'cli' (the vendor's own CLI and login) or 'openai-chat' (OmniSwarm's chat-completions tool loop)
//   family        reviewer-spec family (reviewer-spec.schema.json); the spec syntax is the shared contract
//   specPrefix    a model id becomes a reviewer spec as specPrefix + model
//   modelsPath    GET path that lists the models a key can use, or null
//   keySources    where a key may come from: 'operator-env' (the operator's shell, for `audit local --provider`),
//                 'account' (a signed-in account's own key, the only key the hosted service runs on)
//   dataPolicy    what leaves the machine, shown in docs and the UI

export const MODEL_ID_PATTERN = '^[A-Za-z0-9._:/-]{1,128}$';
const MODEL_ID = new RegExp(MODEL_ID_PATTERN);

export const PUBLIC_PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'local', label: 'Local CLI subscriptions', transport: 'cli', family: 'cli', specPrefix: 'cli:', modelsPath: null,
    keySources: Object.freeze([]),
    dataPolicy: 'Each CLI (claude, codex, grok, agy) uses your own login; reviewed source goes to that CLI\'s vendor under your account terms.',
  }),
  Object.freeze({
    id: 'nearai', label: 'NEAR AI Cloud', transport: 'openai-chat', family: 'nearai', specPrefix: 'nearai:', modelsPath: '/models',
    keySources: Object.freeze(['operator-env', 'account']),
    dataPolicy: 'Reviewed source is sent to NEAR AI Cloud with the key\'s owner billed. OmniSwarm does not yet verify NEAR AI\'s TEE attestation.',
  }),
]);

export function isModelId(model) {
  return typeof model === 'string' && MODEL_ID.test(model);
}

/** Public descriptors of providers whose key a signed-in account may save for its own reviews. */
export function publicAccountProviders() {
  return PUBLIC_PROVIDERS.filter((provider) => provider.keySources.includes('account'));
}

// Presets that run on a signed-in account's own key are named `account-<provider id>`.
export const ACCOUNT_PRESET_PREFIX = 'account-';

export function accountPresetName(providerId) {
  if (!publicAccountProviders().some((provider) => provider.id === providerId)) throw new Error(`${providerId} does not take account keys`);
  return `${ACCOUNT_PRESET_PREFIX}${providerId}`;
}

/** The provider of an `account-<id>` preset, or null for any other preset. */
export function accountPresetProvider(preset) {
  if (typeof preset !== 'string' || !preset.startsWith(ACCOUNT_PRESET_PREFIX)) return null;
  const id = preset.slice(ACCOUNT_PRESET_PREFIX.length);
  return publicAccountProviders().some((provider) => provider.id === id) ? id : null;
}
