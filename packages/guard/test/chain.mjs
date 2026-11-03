// Recorded chain answers for the guard tests. Code hashes are base58 shapes, not real deployments.
// Heights 50 and 107 are older records without block_timestamp_ms: their age comes from the block lookup.
import { createRecordedReader } from '../src/recorded-reader.mjs';
import { EMPTY_CODE_HASH } from '../src/signals.mjs';

export const NOW = Date.UTC(2026, 10, 3);
const DAY = 86_400_000;
export const HASH_A = '8iTgRHpmMG2DzuPFDyBXTSkdxJMKmdNfmYo1sJUFKVNS';
export const HASH_B = 'GKot5hBsd81kMupNCXHaqbhv3huEbxAFMLnpcX2hniwn';
export const HASH_C = '4Q9fJ3mWvHrLyk1sZQxTbYcN7pUe2aDgKmE5oRiV8tBn';

/** @param {string} deployed @param {string} codeHash @param {string} severity @param {number} height */
function attestation(deployed, codeHash, severity, height, confirmed = true) {
  return {
    ...(height === 50 || height === 107 ? {} : { block_timestamp_ms: NOW - 10 * DAY }),
    request_hash: height.toString(16).padStart(64, '0'),
    repo: 'near/example',
    commit: 'c'.repeat(40),
    report_sha256: 'd'.repeat(64),
    report_uri: `https://reports.example/${deployed}`,
    deployed,
    code_hash: codeHash,
    max_severity: severity,
    block_height: height,
    binding_confirmed: confirmed,
  };
}

export const RECORDS = {
  accounts: {
    'clean.testnet': { code_hash: HASH_A, age_days: 400 },
    'critical.testnet': { code_hash: HASH_B, age_days: 400 },
    'changed.testnet': { code_hash: HASH_C, age_days: 400 },
    'stale.testnet': { code_hash: HASH_A, age_days: 900 },
    'unreviewed.testnet': { code_hash: HASH_C, age_days: 400 },
    'unconfirmed.testnet': { code_hash: HASH_A, age_days: 400 },
    'young-clean.testnet': { code_hash: HASH_A, age_days: 3 },
    'reported-clean.testnet': { code_hash: HASH_A, age_days: 400 },
    'old-user.testnet': { code_hash: EMPTY_CODE_HASH, age_days: 900 },
    'new-user.testnet': { code_hash: EMPTY_CODE_HASH, age_days: 2 },
    'attacker.testnet': { code_hash: EMPTY_CODE_HASH, age_days: 400 },
    'token.testnet': { code_hash: HASH_A, age_days: 400 },
    'legacy-clean.testnet': { code_hash: HASH_A, age_days: 400 },
  },
  attestations: {
    'clean.testnet': attestation('clean.testnet', HASH_A, 'low', 100),
    'critical.testnet': attestation('critical.testnet', HASH_B, 'critical', 101),
    'changed.testnet': attestation('changed.testnet', HASH_A, 'critical', 102),
    'stale.testnet': attestation('stale.testnet', HASH_A, 'none', 50),
    'unconfirmed.testnet': attestation('unconfirmed.testnet', HASH_A, 'none', 103, false),
    'young-clean.testnet': attestation('young-clean.testnet', HASH_A, 'medium', 104),
    'reported-clean.testnet': attestation('reported-clean.testnet', HASH_A, 'none', 105),
    'token.testnet': attestation('token.testnet', HASH_A, 'none', 106),
    'legacy-clean.testnet': attestation('legacy-clean.testnet', HASH_A, 'none', 107),
  },
  reported: ['attacker.testnet', 'reported-clean.testnet'],
  blockTimestampsMs: Object.fromEntries([
    ['107', NOW - 10 * DAY],
    ['50', NOW - 400 * DAY],
  ]),
};

/** @param {ReadonlySet<string>} [fail] */
export function reader(fail) {
  return createRecordedReader(RECORDS, { fail });
}

/** A signer spy: counts calls per method. */
export function spySigner() {
  const calls = [];
  const record = (method) => async (params) => {
    calls.push({ method, params });
    return { transaction: { hash: 'spy' } };
  };
  return {
    calls,
    signer: {
      signAndSendTransaction: record('signAndSendTransaction'),
      signAndSendTransactions: record('signAndSendTransactions'),
      transfer: record('transfer'),
      callFunction: record('callFunction'),
      signMessage: record('signMessage'),
    },
  };
}

/** @param {string} receiverId @param {string} [deposit] */
export function transferIntent(receiverId, signerId = 'agent.testnet', deposit = '1000000000000000000000000') {
  return { signerId, receiverId, actions: [{ type: 'Transfer', params: { deposit } }] };
}
