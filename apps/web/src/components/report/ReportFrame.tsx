// Reports quote untrusted target-repo text and run their own nonce'd script, so
// they load in a sandboxed frame without allow-same-origin: the script runs in
// an opaque origin and cannot reach this app's cookies, storage or wallet.
export function ReportFrame({ src, title }: { src: string; title: string }) {
  return (
    <div className="report-frame">
      <iframe className="report-frame__iframe" src={src} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" />
      <p className="report-frame__link"><a href={src} target="_blank" rel="noreferrer">Open the full report in a new tab</a></p>
    </div>
  );
}
