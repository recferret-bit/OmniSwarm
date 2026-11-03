// @ts-check
// createGuard: per-account verdicts, per-intent verdicts, and a signer wrapper that refuses on
// block and asks a human on warn. Every lookup is awaited before the signer is called.

import { requireAccountId } from './account-id.mjs';
import { DEFAULT_POLICY, evaluate } from './engine.mjs';
import { GuardBlockedError, GuardWarnDeclinedError } from './errors.mjs';
import { DEFAULT_BENEFICIARY_ARGS, targetsOf } from './intent.mjs';
import { LEVELS, orderReasons, worst } from './reasons.mjs';
import { collectSignals } from './signals.mjs';

/** @typedef {import('../types.js').GuardOptions} GuardOptions */
/** @typedef {import('../types.js').Guard} Guard */
/** @typedef {import('../types.js').Verdict} Verdict */
/** @typedef {import('../types.js').IntentVerdict} IntentVerdict */
/** @typedef {import('../types.js').TxIntent} TxIntent */
/** @typedef {import('../types.js').ChainAttestation} ChainAttestation */
/** @typedef {import('../types.js').ChainReader} ChainReader */
/** @typedef {import('../types.js').AccountAgeSource} AccountAgeSource */
/** @typedef {import('../types.js').Policy} Policy */

/** Signer methods the wrapper intercepts, and how each one's params become intents. */
const INTERCEPTED = Object.freeze({
  /** @param {any} p @returns {TxIntent[]} */
  signAndSendTransaction: (p) => [p],
  /** @param {any} p @returns {TxIntent[]} */
  signAndSendTransactions: (p) => (Array.isArray(p?.transactions) ? p.transactions : []),
  /** @param {any} p @returns {TxIntent[]} */
  transfer: (p) => [{ receiverId: p?.receiverId, actions: [{ type: 'Transfer', params: { deposit: p?.amount } }] }],
  /** @param {any} p @returns {TxIntent[]} */
  callFunction: (p) => [functionCallIntent(p)],
  /** @param {any} p @returns {TxIntent[]} */
  functionCall: (p) => [functionCallIntent(p)],
});

/** @param {any} p @returns {TxIntent} */
function functionCallIntent(p) {
  return { receiverId: p?.contractId, actions: [{ type: 'FunctionCall', params: { methodName: p?.methodName, args: p?.args, deposit: p?.deposit } }] };
}

/**
 * Maps the contract's snake_case attestation to `attestation.schema.json`.
 * @param {ChainAttestation} a
 */
export function toSchemaAttestation(a) {
  return { requestHash: a.request_hash, reportSha256: a.report_sha256, reportUri: a.report_uri, deployed: a.deployed, codeHash: a.code_hash, maxSeverity: a.max_severity };
}

/**
 * Throws unless `v` has the `guard-verdict-response` shape this package relies on.
 * @param {any} v
 * @returns {Verdict}
 */
export function assertVerdict(v) {
  const ok = v && typeof v === 'object' && LEVELS.includes(v.verdict) && Array.isArray(v.reasons)
    && v.reasons.every((/** @type {unknown} */ r) => typeof r === 'string') && v.signals && typeof v.signals === 'object';
  if (!ok) throw new TypeError('malformed guard verdict');
  return v;
}

/**
 * @param {ChainReader} reader
 * @param {Policy} policy
 * @param {() => number} now
 * @param {AccountAgeSource} [accountAge]
 * @returns {(accountId: string) => Promise<Verdict>}
 */
function readerSource(reader, policy, now, accountAge) {
  return async (accountId) => {
    const { signals, attestation } = await collectSignals(reader, accountId, now, accountAge);
    const { verdict, reasons } = evaluate(signals, attestation ? attestation.max_severity : null, policy);
    return attestation ? { verdict, reasons, signals, attestation: toSchemaAttestation(attestation) } : { verdict, reasons, signals };
  };
}

/**
 * @param {string} accountId
 * @param {unknown} error
 * @returns {Verdict}
 */
function unavailableVerdict(accountId, error) {
  const message = error instanceof Error ? error.message : String(error);
  return { verdict: 'warn', reasons: ['SIGNAL_UNAVAILABLE'], signals: { account: accountId, unavailable: ['verdict'], error: message } };
}

/**
 * @param {GuardOptions} options
 * @param {Policy} policy
 * @returns {(accountId: string) => Promise<Verdict>}
 */
function pickSource(options, policy) {
  const accountAge = options?.accountAge;
  if (accountAge !== undefined && typeof accountAge?.getCreatedAtMs !== 'function') throw new TypeError('accountAge must have getCreatedAtMs');
  if (options?.source) return options.source;
  if (options?.reader) return readerSource(options.reader, policy, options.now ?? Date.now, accountAge);
  throw new TypeError('createGuard needs a reader or a source');
}

/**
 * @param {GuardOptions} options
 * @returns {Guard}
 */
export function createGuard(options) {
  const policy = { ...DEFAULT_POLICY, ...options?.policy };
  const blocklist = new Set(options?.blocklist ?? []);
  const beneficiaryArgs = options?.beneficiaryArgs ?? DEFAULT_BENEFICIARY_ARGS;
  const source = pickSource(options, policy);

  /** @param {string} accountId @returns {Promise<Verdict>} */
  async function check(accountId) {
    requireAccountId(accountId);
    const verdict = assertVerdict(await source(accountId));
    if (!blocklist.has(accountId)) return verdict;
    return { ...verdict, verdict: 'block', reasons: orderReasons(['REPORTED', ...verdict.reasons]), signals: { ...verdict.signals, reported: true } };
  }

  /** @param {TxIntent[]} intents @returns {Promise<IntentVerdict>} */
  async function checkIntents(intents) {
    if (!Array.isArray(intents) || intents.length === 0) throw new TypeError('no transaction to check');
    const targets = intents.flatMap((intent) => targetsOf(intent, beneficiaryArgs));
    const verdicts = await Promise.all(targets.map((t) => check(t.accountId).catch((error) => unavailableVerdict(t.accountId, error))));
    return {
      verdict: worst(verdicts.map((v) => v.verdict)),
      reasons: orderReasons(verdicts.flatMap((v) => v.reasons)),
      targets: targets.map((t, i) => ({ ...t, ...verdicts[i] })),
    };
  }

  /** @type {Guard['wrap']} */
  function wrap(signer, { onWarn } = {}) {
    /** @type {Record<string, (params: any, ...rest: any[]) => Promise<any>>} */
    const wrapped = {};
    for (const [method, toIntents] of Object.entries(INTERCEPTED)) {
      const original = /** @type {any} */ (signer)[method];
      if (typeof original !== 'function') continue;
      wrapped[method] = async (params, ...rest) => {
        const verdict = await checkIntents(toIntents(params));
        if (verdict.verdict === 'block') throw new GuardBlockedError(verdict);
        if (verdict.verdict === 'warn' && (await onWarn?.(verdict)) !== true) throw new GuardWarnDeclinedError(verdict);
        return original.call(signer, params, ...rest);
      };
    }
    // Only the intercepted methods exist on the result; the cast restates that for callers.
    return /** @type {any} */ (Object.freeze(wrapped));
  }

  return Object.freeze({ check, checkIntent: (/** @type {TxIntent} */ intent) => checkIntents([intent]), checkIntents, wrap });
}
