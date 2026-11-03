// Canonical JSON and the report hash (INTAKE section 6). The intake worker attests
// sha256(canonicalJson(findings) + canonicalJson(general ?? {})); the review page
// recomputes the same bytes. Keys are sorted at every depth, there is no whitespace,
// arrays keep their order and scalars are written by JSON.stringify.
// Browser- and Node-safe: no Node imports, hashing uses Web Crypto.

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// The exact string whose sha256 is the report hash.
export function reportDocument(findings, general) {
  return canonicalJson(findings) + canonicalJson(general ?? {});
}

export async function digestReport(findings, general) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(reportDocument(findings, general)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
