// The API's only touch point with @omniswarm/guard (track S). The guard evaluates chain evidence through
// a ChainReader over the API's ChainPort: the NEAR registry in production, the mock registry tables in
// mock-chain mode (container.ts). Swapping either is a change to this file and container.ts only.
import { createGuard, registryReader, type AccountAgeSource, type ChainReader, type Verdict } from '@omniswarm/guard';
import type { ChainPort } from '../../chain/port.ts';

export interface GuardPort {
  verdict(account: string): Promise<Verdict>;
}

/**
 * ChainReader over the registry (INTERFACE.md v0.3.0: get_attestation_for_account, is_reported,
 * get_report, each checked by the guard's registryReader) and RPC. A registry without is_reported
 * makes the signal unavailable rather than "not reported".
 */
export function chainReader(chain: ChainPort): ChainReader {
  return {
    ...registryReader((method, args) => chain.viewRegistry(method, args)),
    getAccount: (accountId) => chain.viewAccount(accountId),
    getBlockTimestampMs: (height) => chain.blockTimestampMs(height),
  };
}

/** `accountAge` is the optional indexer (GUARD_ACCOUNT_AGE); without it the age signal is unavailable. */
export function guardPort(reader: ChainReader, accountAge?: AccountAgeSource): GuardPort {
  const guard = createGuard({ reader, ...(accountAge ? { accountAge } : {}) });
  return { verdict: (account) => guard.check(account) };
}
