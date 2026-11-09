// The registry accepts only an https report URI. The local stack stores and
// links the http URL the browser can open. Rewrite the scheme on the attest
// argument and leave the stored URL alone.
export function chainReportUri(url: string): string {
  if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
  return url;
}
