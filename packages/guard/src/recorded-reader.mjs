// @ts-check
// A ChainReader over recorded chain answers (a snapshot), for tests, the attack demo and the
// API's mock-chain mode. Not a fixture itself: the caller passes the records.

/** @typedef {import('../types.js').ChainReader} ChainReader */
/** @typedef {import('../types.js').RecordedChain} RecordedChain */

/**
 * @param {RecordedChain} records
 * @param {{ fail?: ReadonlySet<keyof ChainReader> }} [options]  methods that reject (outage simulation)
 * @returns {ChainReader}
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
  /** @type {ChainReader} */
  const reader = {
    getAccount: (id) => read('getAccount', () => (accounts[id] ? { codeHash: accounts[id].code_hash } : null)),
    getAccountAgeDays: (id) => read('getAccountAgeDays', () => accounts[id]?.age_days ?? 0),
    getAttestationForAccount: (id) => read('getAttestationForAccount', () => records.attestations?.[id] ?? null),
    isReported: (id) => read('isReported', () => (records.reported ?? []).includes(id)),
    getBlockTimestampMs: (height) =>
      read('getBlockTimestampMs', () => {
        const at = records.blockTimestampsMs?.[String(height)];
        if (at === undefined) throw new Error(`no recorded block ${height}`);
        return at;
      }),
  };
  return Object.freeze(reader);
}
