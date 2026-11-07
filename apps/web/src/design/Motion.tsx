'use client';

import { useState } from 'react';
import { DesignNav } from '@/design/DesignNav';

const DURATIONS = [
  ['instant', '80ms', 'toggles'],
  ['quick', '150ms', 'hover'],
  ['base', '240ms', 'panels'],
  ['plate', '420ms', 'assemble'],
  ['cinematic', '900ms', 'boot'],
] as const;

export function Motion() {
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);

  return (
    <div className={paused ? 'mo is-play is-still' : 'mo is-play'}>
      <DesignNav current="/design/motion" />
      <header className="mo-head">
        <div style={{ maxWidth: '720px' }}>
          <p className="eyebrow">OMNISWARM DESIGN SYSTEM · MOTION</p>
          <h1 className="display">Evidence locks into place</h1>
          <p className="lede">
            Latch easing is for things that seal: a pressed control, a plate, a source digest.
            Sweep easing is for things that travel: a scan, a meter, a claim passed between reviewers.
            Steps are electronic ticks: boot lines and a status word arrive in one frame, not a fade.
            Reduced motion, and Pause, hold the review still.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setPaused(false);
              setRun((value) => value + 1);
            }}
          >
            Replay all
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            Pause
          </button>
        </div>
      </header>

      <div className="mo-durs">
        {DURATIONS.map(([name, ms, use]) => (
          <div key={name}>
            <div className="label">{name}</div>
            <b>{ms}</b>
            <div>{use}</div>
          </div>
        ))}
      </div>

      <div className="mo-grid" key={run}>
        <figure>
          <div className="stage plate">
            <div style={{ display: 'grid', gap: '4px' }}>
              <div className="boot-line mono">sandbox boot</div>
              <div className="boot-line mono c-ok">bridge ok</div>
              <div className="boot-line mono">source digest ok</div>
              <div className="boot-line mono c-cite">reviewers attached</div>
              <div className="boot-line mono c-ember">
                ready <span className="caret" aria-hidden="true">_</span>
              </div>
            </div>
          </div>
          <figcaption>
            <b>Boot</b>
            <span>Sandbox log as the review starts. Steps, one line at a time.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <div className="asm">
              <span className="a" />
              <span className="b" />
              <span className="c" />
              <span className="d" />
            </div>
          </div>
          <figcaption>
            <b>Plate assemble</b>
            <span>A finding plate locking together. Latch easing, cinematic duration.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <span className="latch">REVIEW A REPO</span>
          </div>
          <figcaption>
            <b>Latch press</b>
            <span>The control that starts a review. It settles, then releases.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <div className="scan">
              <div className="label">READING SOURCE</div>
              <div className="readout">412</div>
            </div>
            <div className="scanbar" />
          </div>
          <figcaption>
            <b>Scan sweep</b>
            <span>While source is read. Sweep easing: the bar travels the plate.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <div className="radar">
              <div className="sweep" />
              <span className="blip" style={{ left: '46px', top: '38px' }} />
              <span className="blip" style={{ left: '88px', top: '74px' }} />
            </div>
          </div>
          <figcaption>
            <b>Radar</b>
            <span>Lead sweep. A blip is a harness hit until a reviewer cites the line.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <div style={{ display: 'grid', justifyItems: 'center', gap: '12px' }}>
              <div className="seal">SHA256</div>
              <p className="hash">
                digest digest digest digest <b>MATCH</b>
              </p>
            </div>
          </div>
          <figcaption>
            <b>Hash seal</b>
            <span>The source digest seals when the tree matches. Latch easing.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <div className="debate">
              <span className="mark">A</span>
              <span className="pass" />
              <span className="mark cite">B</span>
            </div>
          </div>
          <figcaption>
            <b>Debate pass</b>
            <span>A claim handed from reviewer A to reviewer B. Sweep easing.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <div className="meter meter-demo"><i /></div>
          </div>
          <figcaption>
            <b>Meter fill</b>
            <span>Review progress fills, then holds. Sweep easing, not a loop.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <div className="cite-line">src/lib.rs:30  missing owner check</div>
          </div>
          <figcaption>
            <b>Cite flash</b>
            <span>The file and line light when evidence is attached.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <div className="toast toast-demo">Quote ready.</div>
          </div>
          <figcaption>
            <b>Toast</b>
            <span>Confirmation after a quote is ready. Plate duration, latch easing.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <span className="tick">ATTESTED</span>
          </div>
          <figcaption>
            <b>Tick</b>
            <span>A status word in one electronic step.</span>
          </figcaption>
        </figure>

        <figure>
          <div className="stage plate">
            <p style={{ maxWidth: '36ch', margin: 0 }}>
              Seals are already closed. The scan does not travel. Citations stay lit.
              Pause holds every specimen on this page still.
              The operating system reduced-motion preference stops the system.
            </p>
          </div>
          <figcaption>
            <b>Reduced motion</b>
            <span>The still review. This specimen does not loop.</span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
