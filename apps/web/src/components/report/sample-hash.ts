// The production bundle must not inline the fixture hash (npm run guard). The
// browser reads the same public file how-sample-hash.ts reads at build time.
export function readSampleHash(): Promise<string> {
  return fetch('/sample/attestation.json')
    .then((response) => (response.ok ? response.json() as Promise<{ report_sha256?: unknown }> : null))
    .then((body) => (typeof body?.report_sha256 === 'string' ? body.report_sha256 : ''))
    .catch(() => '');
}
