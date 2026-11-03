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
 * ChainReader over the registry and RPC. The blocklist is the registry's `is_reported` (approved guard
 * reports are written there by `report_address`); a registry without that view makes the signal
 * unavailable rather than "not reported". No indexer is wired for account age, so that signal is
 * unavailable and the guard never answers `allow` from it.
 */
export function chainReader(chain: ChainPort): ChainReader {
  return {
    getAccount: (accountId) => chain.viewAccount(accountId),
    getAttestationForAccount: async (accountId) => {
      const attestation = await chain.getAttestationForAccount(accountId);
      return attestation ? toContractAttestation(attestation) : null;
    },
    isReported: (accountId) => chain.isReported(accountId),
    getAccountAgeDays: async () => { throw new Error('account age needs an indexer, which is not configured'); },
    getBlockTimestampMs: (height) => chain.blockTimestampMs(height),
  };
}

/** Mock-chain mode: the recorded snapshot, with the mock registry's blocklist added to its `reported`. */
export function withChainBlocklist(reader: ChainReader, chain: ChainPort): ChainReader {
  return { ...reader, isReported: async (accountId) => (await reader.isReported(accountId)) || chain.isReported(accountId) };
}

export function guardPort(reader: ChainReader): GuardPort {
  const guard = createGuard({ reader });
  return { verdict: (account) => guard.check(account) };
}
