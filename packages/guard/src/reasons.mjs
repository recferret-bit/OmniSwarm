// @ts-check
// Reason codes (W13-01) and the verdict level each one forces. Order is the order reasons are listed in.

/** @typedef {'allow' | 'warn' | 'block'} Level */
/** Informational codes are listed and never raise the verdict. */
/** @typedef {Level | 'info'} ReasonLevel */

/** @type {Readonly<Record<string, ReasonLevel>>} */
export const REASONS = Object.freeze({
  REPORTED: 'block',
  ATTESTED_CRITICAL_STILL_DEPLOYED: 'block',
  CODE_CHANGED_SINCE_REVIEW: 'warn',
  CONTRACT_NOT_REVIEWED: 'warn',
  ATTESTATION_STALE: 'warn',
  ACCOUNT_TOO_NEW: 'warn',
  SOURCE_METADATA_MISMATCH: 'warn',
  SIGNAL_UNAVAILABLE: 'warn',
  SOURCE_METADATA_ABSENT: 'info',
  ATTESTED_CLEAN: 'allow',
  NOT_A_CONTRACT: 'allow',
});

export const REASON_CODES = Object.freeze(Object.keys(REASONS));

/** @type {readonly Level[]} */
export const LEVELS = Object.freeze(['allow', 'warn', 'block']);

/**
 * The worst verdict among `levels`. `info` does not raise it. `allow` when empty.
 * @param {Iterable<ReasonLevel>} levels
 * @returns {Level}
 */
export function worst(levels) {
  let rank = 0;
  for (const level of levels) {
    // `info` is listed and does not raise the verdict.
    if (level === 'block') rank = 2;
    else if (level === 'warn' && rank < 2) rank = 1;
  }
  return LEVELS[rank];
}

/**
 * Known codes in canonical order, then any other reason strings (for example text from a
 * remote source) in their original order. Duplicates are dropped.
 * @param {Iterable<string>} codes
 * @returns {string[]}
 */
export function orderReasons(codes) {
  const set = new Set(codes);
  return [...REASON_CODES.filter((code) => set.has(code)), ...[...set].filter((code) => !(code in REASONS))];
}
