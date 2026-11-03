// The attestation hex is stored on its own. The page recomputes sha256 over the
// canonical findings and general-review documents and compares the two.
export const REPORT_FINDINGS = { findings: [{ id: 'F-1', severity: 'low', title: 'Missing owner check' }] };
export const REPORT_GENERAL = { summary: 'No critical issue in this sample.' };
export const TAMPED_FINDINGS = { findings: [{ id: 'F-1', severity: 'low', title: 'Missing owner check (tampered)' }] };

export const ATTESTED_SHA256 = 'f1d565b590ebe3953a45032be451719096222b9ee003ceee21900c1136bc35b1';

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function digestReport(findings: unknown, general: unknown): Promise<string> {
  const payload = canonicalJson(findings) + canonicalJson(general ?? {});
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
