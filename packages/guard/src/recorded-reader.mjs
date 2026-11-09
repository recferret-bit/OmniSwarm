// @ts-check
// A ChainReader and an AccountAgeSource over recorded answers (a snapshot), for tests, the attack
// demo and the API's mock-chain mode. Not fixtures themselves: the caller passes the records.

/** @typedef {import('../types.js').ChainReader} ChainReader */
/** @typedef {import('../types.js').RecordedChain} RecordedChain */
/** @typedef {import('../types.js').AccountAgeSource} AccountAgeSource */

/**
 * @param {RecordedChain} records
 * @param {{ fail?: ReadonlySet<keyof ChainReader> }} [options]  methods that reject (outage simulation)
 * @returns {Required<ChainReader>}
 */
export function createRecordedReader(records, { fail = new Set() } = {}) {
  /**
   * @template T
   * @param {keyof ChainReader} method
   * @param {() => T} answer
   * @returns {Promise<T>}
   */
  const read = async (method, answer) => {
    if (fail.has(method)) throw new Error(`${method} unavailable`);
    return answer();
  };
  const accounts = records.accounts ?? {};
  const reports = records.reports ?? {};
  /** @type {Required<ChainReader>} */
  const reader = {
    getAccount: (id) => read('getAccount', () => (accounts[id] ? { codeHash: accounts[id].code_hash } : null)),
    getAccountAgeDays: (id) => read('getAccountAgeDays', () => accounts[id]?.age_days ?? 0),
    getAttestationForAccount: (id) => read('getAttestationForAccount', () => records.attestations?.[id] ?? null),
    isReported: (id) => read('isReported', () => (records.reported ?? []).includes(id) || Object.hasOwn(reports, id)),
    getReport: (id) => read('getReport', () => (Object.hasOwn(reports, id) ? reports[id] : null)),
    getBlockTimestampMs: (height) =>
      read('getBlockTimestampMs', () => {
        const at = records.blockTimestampsMs?.[String(height)];
        if (at === undefined) throw new Error(`no recorded block ${height}`);
        return at;
      }),
    // `undefined` (no table) leaves the signal unset, so older snapshots keep their verdicts.
    // A missing account, or null, means the contract has no contract_source_metadata.
    getSourceMetadata: (id) => read('getSourceMetadata', () => {
      if (!Object.hasOwn(records, 'sourceMetadata')) return undefined;
      const table = records.sourceMetadata ?? {};
      return Object.hasOwn(table, id) ? table[id] : null;
    }),
  };
  return Object.freeze(reader);
}

/**
 * An AccountAgeSource over recorded creation times. Unknown accounts answer null.
 * @param {Record<string, number>} createdAtMs  account id → creation time in ms
 * @param {{ fail?: boolean }} [options]  reject every lookup (outage simulation)
 * @returns {AccountAgeSource}
 */
export function createRecordedAgeSource(createdAtMs, { fail = false } = {}) {
  return Object.freeze({
    getCreatedAtMs: async (/** @type {string} */ id) => {
      if (fail) throw new Error('account age source unavailable');
      return Object.hasOwn(createdAtMs, id) ? createdAtMs[id] : null;
    },
  });
}
