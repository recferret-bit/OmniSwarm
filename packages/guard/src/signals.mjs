// @ts-check
// Collects every signal for one account through the chain reader port and the optional
// account-age port. Each signal that cannot be read is null and named in `unavailable`;
// nothing here throws on a reader error.

/** @typedef {import('../types.js').ChainReader} ChainReader */
/** @typedef {import('../types.js').ChainAttestation} ChainAttestation */
/** @typedef {import('../types.js').AccountAgeSource} AccountAgeSource */
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

/** @param {number} at @param {() => number} now */
const daysSince = (at, now) => Math.max(0, Math.floor((now() - at) / DAY_MS));

/**
 * Age in days from the age port if configured, else the reader's older method, else rejected.
 * @param {ChainReader} reader
 * @param {AccountAgeSource | undefined} accountAge
 * @param {string} accountId
 * @param {() => number} now
 * @returns {Promise<number>}
 */
async function readAge(reader, accountAge, accountId, now) {
  if (accountAge) {
    const at = await accountAge.getCreatedAtMs(accountId);
    if (typeof at !== 'number' || !Number.isFinite(at)) throw new Error('account age source does not know the account');
    return daysSince(at, now);
  }
  if (typeof reader.getAccountAgeDays === 'function') return reader.getAccountAgeDays(accountId);
  throw new Error('no account age source is configured');
}

/** @param {ChainReader} reader @param {string} accountId */
async function readReported(reader, accountId) {
  const reported = await reader.isReported(accountId);
  if (typeof reported !== 'boolean') throw new TypeError('isReported must resolve to a boolean');
  return reported;
}

/**
 * The registry's evidence for a reported account, when the reader can fetch it.
 * @param {ChainReader} reader
 * @param {string} accountId
 * @param {string[]} unavailable
 * @returns {Promise<Signals['report'] | null>}
 */
async function readReport(reader, accountId, unavailable) {
  if (typeof reader.getReport !== 'function') return null;
  try {
    const r = await reader.getReport(accountId);
    return r ? { evidenceUri: r.evidence_uri, reason: r.reason, reportedAtMs: r.reported_at_ms, reporter: r.reporter } : null;
  } catch {
    unavailable.push('report');
    return null;
  }
}

/**
 * @param {ChainReader} reader
 * @param {string} accountId
 * @param {() => number} now
 * @param {AccountAgeSource} [accountAge]
 * @returns {Promise<{ signals: Signals, attestation: ChainAttestation | null }>}
 */
export async function collectSignals(reader, accountId, now, accountAge) {
  /** @type {string[]} */
  const unavailable = [];
  const settled = await Promise.allSettled([
    reader.getAccount(accountId),
    reader.getAttestationForAccount(accountId),
    readReported(reader, accountId),
    readAge(reader, accountAge, accountId, now),
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
  const report = reported === true ? await readReport(reader, accountId, unavailable) : null;

  /** @type {Signals} */
  const signals = {
    account: accountId,
    exists,
    isContract: exists === false ? false : account ? codeHash !== EMPTY_CODE_HASH : null,
    codeHash,
    reported,
    ageDays: exists === false ? 0 : age,
    hasAttestation: settled[1].status === 'fulfilled' ? attestation !== null : null,
    unconfirmedBinding: found !== null && attestation === null,
    attestedCodeHash: attestation ? attestation.code_hash : null,
    codeHashMatches: attestation && codeHash !== null ? attestation.code_hash === codeHash : null,
    attestationAgeDays,
    review: attestation ? { repo: attestation.repo, commit: attestation.commit, blockHeight: attestation.block_height } : null,
    ...(report ? { report } : {}),
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
    const recorded = attestation.block_timestamp_ms;
    const at = typeof recorded === 'number' ? recorded : await reader.getBlockTimestampMs(attestation.block_height);
    return daysSince(at, now);
  } catch {
    unavailable.push('attestationAge');
    return null;
  }
}
