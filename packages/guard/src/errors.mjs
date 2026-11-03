// @ts-check

/** @typedef {import('../types.js').IntentVerdict} IntentVerdict */

/** Thrown before the signer is reached when the verdict is `block`. */
export class GuardBlockedError extends Error {
  /** @param {IntentVerdict} verdict */
  constructor(verdict) {
    super(`guard blocked ${verdict.targets.map((t) => t.accountId).join(', ')}: ${verdict.reasons.join(', ')}`);
    this.name = 'GuardBlockedError';
    this.code = 'GUARD_BLOCK';
    this.verdict = verdict;
  }
}

/** Thrown before the signer is reached when the verdict is `warn` and `onWarn` did not return `true`. */
export class GuardWarnDeclinedError extends Error {
  /** @param {IntentVerdict} verdict */
  constructor(verdict) {
    super(`guard warning was not approved: ${verdict.reasons.join(', ')}`);
    this.name = 'GuardWarnDeclinedError';
    this.code = 'GUARD_WARN_DECLINED';
    this.verdict = verdict;
  }
}
