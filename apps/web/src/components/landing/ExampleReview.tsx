'use client';

import Link from 'next/link';
import { useState } from 'react';
import './example.css';

const VOICES = [
  { id: 'claude', name: 'Claude', line: 'Missing owner check on withdraw.' },
  { id: 'glm', name: 'GLM 5.3', line: 'Same line. Still a model assertion.' },
  { id: 'qwen', name: 'Qwen', line: 'Same citation. A judge still has to rule.' },
] as const;

export function ExampleReview() {
  const [voice, setVoice] = useState(0);
  const current = VOICES[voice] ?? VOICES[0];
  return (
    <section className="land-section band" id="example" aria-labelledby="example-title">
      <div className="container-wide">
        <header className="land-head">
          <p className="land-kicker"><i>03</i><span className="eyebrow">Example</span></p>
          <h2 id="example-title" className="h2">One disputed line, three citations</h2>
          <p className="lede">From the bundled sample. High severity. Agreement is not a certificate.</p>
        </header>
        <div className="ex-grid">
          <div className="stack">
            <p className="label ex-path">src/lib.rs:30 · missing owner check</p>
            <pre className="ex-code"><code>
              <span className="dim">fn withdraw(account_id, amount) {'{'}</span>{'\n'}
              <span className="line">  transfer(account_id, amount);</span>{'\n'}
              <span className="dim">{'}'}</span>
            </code></pre>
            <p className="muted ex-note">Illustration of the sample finding. Not a live audit of this repository.</p>
          </div>
          <div className="stack">
            <div className="ex-tabs" role="tablist" aria-label="Reviewer citation">
              {VOICES.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className="btn btn-sm btn-ghost"
                  role="tab"
                  id={`example-tab-${item.id}`}
                  aria-selected={index === voice}
                  aria-controls="example-panel"
                  tabIndex={index === voice ? 0 : -1}
                  onClick={() => setVoice(index)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <div id="example-panel" role="tabpanel" aria-labelledby={`example-tab-${current.id}`}>
              <p className="label">{current.name}</p>
              <p className="ex-quote">{current.line}</p>
            </div>
            <div className="ex-judge">
              <span className="badge badge-warn">Disputed</span>
              <p>One disputed finding remains. Quotes disagree.</p>
            </div>
            <Link className="btn btn-system" href="/sample">Open the sample report</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
