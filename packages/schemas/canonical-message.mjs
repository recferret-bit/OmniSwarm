// Canonical NEP-413 request message and its hash (INTAKE section 3, step 4).
// Browser- and Node-safe: no Node imports, hashing uses Web Crypto.
// Keys are sorted, there is no whitespace, `v` is 1, and `deployed` is null when absent.

const FIELDS = ['account', 'commit', 'deployed', 'network', 'nonce', 'preset', 'repo'];

export function canonicalRequestMessage(input) {
  if (!input || typeof input !== 'object') throw new TypeError('canonicalRequestMessage expects an object');
  const out = { v: 1 };
  for (const key of FIELDS) {
    let value = input[key];
    if (key === 'deployed' && (value === undefined || value === null)) value = null;
    else if (typeof value !== 'string' || value === '') throw new TypeError(`${key} must be a non-empty string`);
    out[key] = value;
  }
  const extra = Object.keys(input).filter((k) => !FIELDS.includes(k));
  if (extra.length) throw new TypeError(`unexpected field: ${extra[0]}`);
  return '{' + Object.keys(out).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(out[k])}`).join(',') + '}';
}

export async function requestHash(message) {
  if (typeof message !== 'string') throw new TypeError('requestHash expects the canonical message string');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
