// @ts-check
// The registry half of a ChainReader, over one generic view call. Method names and argument
// shapes are those of contracts/review-registry/INTERFACE.md (v0.3.0). Every answer is checked;
// a wrong shape rejects, which the guard turns into SIGNAL_UNAVAILABLE rather than a silent `false`.

/** @typedef {import('../types.js').ChainReader} ChainReader */
/** @typedef {import('../types.js').ChainReport} ChainReport */
/** @typedef {import('../types.js').ChainAttestation} ChainAttestation */
/** @typedef {import('../types.js').RegistryView} RegistryView */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {string} method @returns {never} */
function malformed(method) {
  throw new TypeError(`registry ${method} returned an unexpected shape`);
}

/** @param {unknown} v @returns {ChainReport | null} */
function asReport(v) {
  if (v === null) return null;
  const ok = isObject(v) && typeof v.account_id === 'string' && typeof v.reporter === 'string' && typeof v.reason === 'string'
    && typeof v.evidence_uri === 'string' && v.evidence_uri.startsWith('https://') && Number.isSafeInteger(v.reported_at_ms);
  return ok ? /** @type {ChainReport} */ (/** @type {unknown} */ (v)) : malformed('get_report');
}

/** @param {unknown} v @returns {ChainAttestation | null} */
function asAttestation(v) {
  if (v === null) return null;
  const ok = isObject(v) && typeof v.request_hash === 'string' && typeof v.binding_confirmed === 'boolean' && typeof v.max_severity === 'string';
  return ok ? /** @type {ChainAttestation} */ (/** @type {unknown} */ (v)) : malformed('get_attestation_for_account');
}

/**
 * @param {RegistryView} view  view call on the registry contract at finality `final`
 * @returns {Pick<Required<ChainReader>, 'getAttestationForAccount' | 'isReported' | 'getReport'>}
 */
/**
 * True when a view failed because the account has no such method (NEP-330 not embedded).
 * Transport and malformed-JSON failures are not this.
 * @param {unknown} error
 */
export function isMissingContractMethod(error) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  return /MethodResolveError|MethodNotFound|method not found|MethodNotFound/i.test(text);
}

/**
 * `contract_source_metadata` on the receiver. A missing method is null. Anything else throws,
 * which the guard turns into SIGNAL_UNAVAILABLE.
 * @param {(accountId: string, method: string, args: Record<string, unknown>) => Promise<unknown>} view
 * @param {string} accountId
 */
export async function viewSourceMetadata(view, accountId) {
  try {
    return await view(accountId, 'contract_source_metadata', {});
  } catch (error) {
    if (isMissingContractMethod(error)) return null;
    throw error;
  }
}

/**
 * @param {RegistryView} view  view call on the registry contract at finality `final`
 * @returns {Pick<Required<ChainReader>, 'getAttestationForAccount' | 'isReported' | 'getReport'>}
 */
export function registryReader(view) {
  if (typeof view !== 'function') throw new TypeError('registryReader needs a view function');
  return Object.freeze({
    getAttestationForAccount: async (/** @type {string} */ accountId) => asAttestation(await view('get_attestation_for_account', { account: accountId })),
    isReported: async (/** @type {string} */ accountId) => {
      const reported = await view('is_reported', { account_id: accountId });
      return typeof reported === 'boolean' ? reported : malformed('is_reported');
    },
    getReport: async (/** @type {string} */ accountId) => asReport(await view('get_report', { account_id: accountId })),
  });
}
