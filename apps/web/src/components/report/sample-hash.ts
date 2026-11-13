// Inlining this hash fails `npm run guard`. The browser reads the public file.
const REPORT_HASH = /^[0-9a-f]{64}$/;

export function isReportHash(value: string): boolean {
  return REPORT_HASH.test(value);
}

export function readSampleHash(): Promise<string> {
  return fetch('/sample/report-hash.json')
    .then((response) => (response.ok ? response.json() as Promise<{ reportSha256?: unknown }> : null))
    .then((body) => (typeof body?.reportSha256 === 'string' && isReportHash(body.reportSha256) ? body.reportSha256 : ''))
    .catch(() => '');
}
