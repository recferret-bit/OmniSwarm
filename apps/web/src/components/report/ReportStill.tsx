'use client';

import { useEffect, useRef, useState } from 'react';
import './report-still.css';

const REPORT = '/sample/report.html';
const HASH = 'cd8a533dc78a6d48e47e7fbe6bb7f9f591badd1e5854564cd4f3dd8f09ca38ab';

export function ReportStill({ linked = true }: { linked?: boolean }) {
  const [page, setPage] = useState<0 | 1>(0);
  const stage = useRef<HTMLDivElement>(null);
  const open = linked ? '/sample' : REPORT;

  useEffect(() => {
    const node = stage.current;
    if (!node) return undefined;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (page === 1 || media?.matches) {
      node.style.transform = '';
      return undefined;
    }
    let frame = 0;
    let live = true;
    const tick = (now: number) => {
      if (!live) return;
      const cycle = 2600;
      const t = (now % cycle) / cycle;
      const start = 0.64;
      const dur = 0.26;
      let x = 0;
      let angle = 0;
      if (t > start && t < start + dur) {
        const u = (t - start) / dur;
        const decay = 1 - u * u;
        const wave = Math.sin(u * Math.PI * 5);
        x = wave * decay * 9;
        angle = wave * decay * 0.9;
      }
      node.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0) rotate(${angle.toFixed(3)}deg)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      node.style.transform = '';
    };
  }, [page]);

  const turn = () => setPage((current) => (current === 0 ? 1 : 0));

  return (
    <figure className="report-still">
      <div
        ref={stage}
        className={`report-stage${page === 1 ? ' is-findings' : ' is-cta'}`}
        role="button"
        tabIndex={0}
        aria-expanded={page === 1}
        aria-label={page === 0 ? 'Turn the report to the finding' : 'Turn the report back to the overview'}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a')) return;
          turn();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            turn();
          }
        }}
      >
        <div className="report-stage__card">
          <article className="report-page" id="report-page-overview">
            <header className="report-doc__bar">
              <span>Security intelligence / 01 Overview</span>
              <span>2026-11-02 · legacy-fixture</span>
            </header>
            <div className="report-doc__hero">
              <div>
                <p className="eyebrow">Source assessment</p>
                <p className="report-doc__title">Audit <em>report.</em></p>
                <p className="report-doc__target">One disputed cluster. Not a certificate.</p>
                <p className="report-doc__sum">One disputed finding remains. Model assertions, not a safety certificate. The hash is what you can check.</p>
              </div>
              <aside className="report-doc__status">
                <p className="label">Assertions</p>
                <p className="report-doc__count">8</p>
                <p>all high · one line</p>
              </aside>
            </div>
            <dl className="report-doc__stats">
              <div><dt>Reviewers</dt><dd>5</dd></div>
              <div><dt>Passes</dt><dd>2</dd></div>
              <div><dt>Calls</dt><dd>40</dd></div>
              <div><dt>Disputed</dt><dd>1</dd></div>
            </dl>
            <section className="report-doc__body">
              <p className="label">Surface</p>
              <p className="report-doc__surface"><b>S1 Identity</b> 1 high claim. Priority 5.1. The other surfaces are out of scope for this sample.</p>
              <p className="report-doc__hash"><span className="label">SHA256</span> {HASH}</p>
            </section>
            <p className="report-doc__notice"><b>Click the page</b> It turns to the finding.</p>
          </article>
          <article className="report-page report-page--back" id="report-page-findings">
            <header className="report-doc__bar">
              <span>Security intelligence / 02 Findings</span>
              <span>1 adjudicated claim</span>
            </header>
            <p className="eyebrow">High · disputed · S1</p>
            <h3 className="report-doc__issue">Missing owner check</h3>
            <p className="report-doc__impact">Any caller can withdraw.</p>
            <p className="report-doc__path">src/lib.rs:16</p>
            <pre className="report-doc__code"><code>{`fn withdraw(account_id, amount) {\n  transfer(account_id, amount);\n}`}</code></pre>
            <div className="report-doc__split">
              <div>
                <p className="label">Impact</p>
                <p>withdraw does not compare the predecessor to the owner. A balance is enough.</p>
              </div>
              <div>
                <p className="label">Fix</p>
                <p>Compare the predecessor to the owner before the transfer.</p>
              </div>
            </div>
            <dl className="report-doc__stats">
              <div><dt>Priority</dt><dd>5.1</dd></div>
              <div><dt>Assertions</dt><dd>8</dd></div>
              <div><dt>Files</dt><dd>1</dd></div>
              <div><dt>Rounds</dt><dd>2</dd></div>
            </dl>
            <p className="report-doc__note">Eight model assertions land on this claim. Quotes disagree, so a judge from another family still has to rule. Click to turn back.</p>
          </article>
        </div>
      </div>
      <figcaption>
        <div className="report-still__meta">
          <span className="label">legacy-fixture · two pages</span>
          <strong>8 assertions, 1 disputed claim, priority 5.1.</strong>
        </div>
        <div className="report-still__actions">
          <a className="btn btn-primary btn-lg" href={open}>Open the sample</a>
          <a className="btn btn-system btn-lg" href={`${REPORT}#findings`}>Open the finding</a>
        </div>
      </figcaption>
    </figure>
  );
}
