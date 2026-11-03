// @ts-check
// @omniswarm/guard: allow / warn / block for NEAR transaction intents. Types: index.d.ts.
export { createGuard, assertVerdict, toSchemaAttestation } from './src/guard.mjs';
export { evaluate, DEFAULT_POLICY } from './src/engine.mjs';
export { GuardBlockedError, GuardWarnDeclinedError } from './src/errors.mjs';
export { httpSource } from './src/http-source.mjs';
export { targetsOf, DEFAULT_BENEFICIARY_ARGS } from './src/intent.mjs';
export { isAccountId } from './src/account-id.mjs';
export { REASONS, REASON_CODES } from './src/reasons.mjs';
export { EMPTY_CODE_HASH } from './src/signals.mjs';
