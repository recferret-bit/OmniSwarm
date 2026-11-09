// @ts-check
// Pure verdict engine (INTAKE §7): signals in, verdict and reasons out. block > warn > allow.

import { sourceMetadataKind } from './source-metadata.mjs';
import { REASONS, orderReasons, worst } from './reasons.mjs';

/** @typedef {import('../types.js').Signals} Signals */
/** @typedef {import('../types.js').Policy} Policy */
/** @typedef {import('./reasons.mjs').Level} Level */

/** @type {Readonly<Policy>} */
export const DEFAULT_POLICY = Object.freeze({ minAgeDays: 30, maxAttestAgeDays: 180, severeLevels: ['critical', 'high'] });

/**
 * @param {Signals} s
 * @param {string | null} severity  max_severity of the confirmed attestation, if any
 * @param {Policy} policy
 * @returns {{ verdict: Level, reasons: string[] }}
 */
export function evaluate(s, severity, policy = DEFAULT_POLICY) {
  /** @type {string[]} */
  const codes = [];
  if (s.reported === true) codes.push('REPORTED');
  if (severity !== null) {
    const severe = policy.severeLevels.includes(severity);
    if (s.codeHashMatches === false) codes.push('CODE_CHANGED_SINCE_REVIEW');
    if (s.codeHashMatches === true) codes.push(severe ? 'ATTESTED_CRITICAL_STILL_DEPLOYED' : 'ATTESTED_CLEAN');
    if (s.attestationAgeDays !== null && s.attestationAgeDays > policy.maxAttestAgeDays) codes.push('ATTESTATION_STALE');
  } else if (s.isContract === true && s.hasAttestation === false) {
    codes.push('CONTRACT_NOT_REVIEWED');
  }
  if (s.isContract === false) codes.push('NOT_A_CONTRACT');
  if (s.ageDays !== null && s.ageDays < policy.minAgeDays) codes.push('ACCOUNT_TOO_NEW');
  // Absent metadata is info and does not decide the verdict. A failed read is SIGNAL_UNAVAILABLE,
  // added below, and is not also reported as absent. The metadata is self-reported.
  if (s.review && Object.hasOwn(s, 'sourceMetadata') && !s.unavailable.includes('sourceMetadata')) {
    const kind = sourceMetadataKind(s.sourceMetadata ?? null, s.review);
    if (kind === 'mismatch') codes.push('SOURCE_METADATA_MISMATCH');
    else if (kind === 'absent') codes.push('SOURCE_METADATA_ABSENT');
  }
  if (s.unavailable.length > 0) codes.push('SIGNAL_UNAVAILABLE');

  const reasons = orderReasons(codes);
  const verdict = worst(reasons.map((code) => REASONS[code]));
  // `allow` needs a positive reason; an empty list means nothing could be established.
  if (reasons.length === 0) return { verdict: 'warn', reasons: ['SIGNAL_UNAVAILABLE'] };
  return { verdict, reasons };
}
