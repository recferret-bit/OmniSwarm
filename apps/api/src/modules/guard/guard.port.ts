// The API's only touch point with @omniswarm/guard (track S). The guard evaluates chain evidence through
// a ChainReader: in production the API's NEAR ChainPort, in mock-chain mode a recorded snapshot
// (container.ts). Swapping either is a change to this file and container.ts only.
import { createGuard, type ChainReader, type Verdict } from '@omniswarm/guard';
import { toContractAttestation } from '../../chain/near/attestation.ts';
import type { ChainPort } from '../../chain/port.ts';

export interface GuardPort {
  verdict(account: string): Promise<Verdict>;
}

/**
 * ChainReader over the registry and RPC. There is no shared blocklist yet (the registry has no
 * `is_reported` and the API stores no approved reports), so nothing is reported; and no indexer is
 * wired for account age, so that signal is unavailable and the guard never answers `allow` from it.
 */
export function chainReader(chain: ChainPort): ChainReader {
  return {
    getAccount: (accountId) => chain.viewAccount(accountId),
    getAttestationForAccount: async (accountId) => {
      const attestation = await chain.getAttestationForAccount(accountId);
      return attestation ? toContractAttestation(attestation) : null;
    },
    isReported: async () => false,
    getAccountAgeDays: async () => { throw new Error('account age needs an indexer, which is not configured'); },
    getBlockTimestampMs: (height) => chain.blockTimestampMs(height),
  };
}

export function guardPort(reader: ChainReader): GuardPort {
  const guard = createGuard({ reader });
  return { verdict: (account) => guard.check(account) };
}
