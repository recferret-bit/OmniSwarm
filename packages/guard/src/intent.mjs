// @ts-check
// Which accounts a transaction intent pays or calls. The receiver is always checked; for
// function calls, account ids under beneficiary argument names (`ft_transfer.receiver_id`,
// a payout contract's `receiver`) are checked too, because that is where the money goes.

import { isAccountId, requireAccountId } from './account-id.mjs';

/** @typedef {import('../types.js').TxIntent} TxIntent */
/** @typedef {import('../types.js').Target} Target */

export const DEFAULT_BENEFICIARY_ARGS = Object.freeze(['receiver_id', 'receiver', 'beneficiary_id', 'to']);

/**
 * @param {unknown} args
 * @returns {Record<string, unknown>}
 */
function argsObject(args) {
  if (args instanceof Uint8Array) {
    try {
      return argsObject(JSON.parse(new TextDecoder().decode(args)));
    } catch {
      return {};
    }
  }
  return args && typeof args === 'object' && !Array.isArray(args) ? /** @type {Record<string, unknown>} */ (args) : {};
}

/**
 * Function-call params in the wallet format (`{type:'FunctionCall', params}`) or the
 * near-api-js action format (`{functionCall}`); null for any other action.
 * @param {any} action
 * @returns {{ methodName?: string, args?: unknown } | null}
 */
function functionCallOf(action) {
  if (action?.type === 'FunctionCall') return action.params ?? {};
  if (action?.functionCall && typeof action.functionCall === 'object') return action.functionCall;
  return null;
}

/**
 * @param {TxIntent} intent
 * @param {readonly string[]} beneficiaryArgs
 * @returns {Target[]}
 */
export function targetsOf(intent, beneficiaryArgs = DEFAULT_BENEFICIARY_ARGS) {
  if (!intent || typeof intent !== 'object') throw new TypeError('transaction intent must be an object');
  const receiverId = requireAccountId(intent.receiverId);
  /** @type {Target[]} */
  const targets = [{ accountId: receiverId, role: 'receiver' }];
  for (const action of intent.actions ?? []) {
    const call = functionCallOf(action);
    if (!call) continue;
    const args = argsObject(call.args);
    for (const key of beneficiaryArgs) {
      const value = args[key];
      if (isAccountId(value)) targets.push({ accountId: value, role: 'beneficiary', via: `${call.methodName}.${key}` });
    }
  }
  const seen = new Set();
  return targets.filter((t) => !seen.has(t.accountId) && seen.add(t.accountId));
}
