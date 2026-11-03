// @ts-check
// NEAR account id rules: 2-64 chars, lowercase alphanumeric parts joined by `-` or `_`, dot-separated.

const ACCOUNT_ID = /^(?:(?:[a-z\d]+[-_])*[a-z\d]+\.)*(?:[a-z\d]+[-_])*[a-z\d]+$/;

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isAccountId(value) {
  return typeof value === 'string' && value.length >= 2 && value.length <= 64 && ACCOUNT_ID.test(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function requireAccountId(value) {
  if (!isAccountId(value)) throw new TypeError(`invalid NEAR account id: ${JSON.stringify(value)}`);
  return value;
}
