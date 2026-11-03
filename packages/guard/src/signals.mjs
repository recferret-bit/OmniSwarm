// @ts-check
// Collects every signal for one account through the chain reader port. Each signal that
// cannot be read is null and named in `unavailable`; nothing here throws on a reader error.

/** @typedef {import('../types.js').ChainReader} ChainReader */
/** @typedef {import('../types.js').ChainAttestation} ChainAttestation */
/** @typedef {import('../types.js').Signals} Signals */

/** Hash NEAR reports for an account without code. */
export const EMPTY_CODE_HASH = '11111111111111111111111111111111';
const DAY_MS = 86_400_000;

/**
 * @template T
 * @param {PromiseSettledResult<T>} result
 * @param {string} name
 * @param {string[]} unavailable
 * @returns {T | null}
 */
function valueOf(result, name, unavailable) {
  if (result.status === 'fulfilled') return result.value;
  unavailable.push(name);
  return null;
}

/**
 * @param {ChainReader} reader
 * @param {string} accountId
 * @param {() => number} now
 * @returns {Promise<{ signals: Signals, attestation: ChainAttestation | null }>}
 */
export async function collectSignals(reader, accountId, now) {
  /** @type {string[]} */
  const unavailable = [];
  const settled = await Promise.allSettled([
    reader.getAccount(accountId),
    reader.getAttestationForAccount(accountId),
    reader.isReported(accountId),
    reader.getAccountAgeDays(accountId),
  ]);
  const account = valueOf(settled[0], 'account', unavailable);
  const found = valueOf(settled[1], 'attestation', unavailable);
  const reported = valueOf(settled[2], 'reported', unavailable);
  const age = valueOf(settled[3], 'accountAge', unavailable);
  const exists = settled[0].status === 'fulfilled' ? account !== null : null;

  // The registry view returns confirmed bindings only; refuse anything else as well.
  const attestation = found && found.binding_confirmed === true ? found : null;
  const codeHash = account ? account.codeHash : null;
  const attestationAgeDays = attestation ? await ageOf(reader, attestation, now, unavailable) : null;

  /** @type {Signals} */
  const signals = {
    account: accountId,
    exists,
    isContract: exists === false ? false : account ? codeHash !== EMPTY_CODE_HASH : null,
    codeHash,
    reported: reported === null ? null : reported === true,
    ageDays: exists === false ? 0 : age,
    hasAttestation: settled[1].status === 'fulfilled' ? attestation !== null : null,
    unconfirmedBinding: found !== null && attestation === null,
    attestedCodeHash: attestation ? attestation.code_hash : null,
    codeHashMatches: attestation && codeHash !== null ? attestation.code_hash === codeHash : null,
    attestationAgeDays,
    review: attestation ? { repo: attestation.repo, commit: attestation.commit, blockHeight: attestation.block_height } : null,
    unavailable,
  };
  return { signals, attestation };
}

/**
 * @param {ChainReader} reader
 * @param {ChainAttestation} attestation
 * @param {() => number} now
 * @param {string[]} unavailable
 */
async function ageOf(reader, attestation, now, unavailable) {
  try {
    const at = await reader.getBlockTimestampMs(attestation.block_height);
    return Math.max(0, Math.floor((now() - at) / DAY_MS));
  } catch {
    unavailable.push('attestationAge');
    return null;
  }
}
