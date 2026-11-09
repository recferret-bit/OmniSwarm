// Inlining this hash fails `npm run guard`. The browser reads the public file.
const REPORT_HASH = /^[0-9a-f]{64}$/;

export function isReportHash(value: string): boolean {
  return REPORT_HASH.test(value);
}

export function readSampleHash(): Promise<string> {
  return fetch('/sample/attestation.json')
    .then((response) => (response.ok ? response.json() as Promise<{ report_sha256?: unknown }> : null))
    .then((body) => (typeof body?.report_sha256 === 'string' && isReportHash(body.report_sha256) ? body.report_sha256 : ''))
    .catch(() => '');
}
