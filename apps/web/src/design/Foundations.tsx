import type { ReactNode } from 'react';
import { DesignNav } from '@/design/DesignNav';

const RULES = [
  'Raw color lives in tokens.css. Components use the variables.',
  'Corners are chamfered. The live status dot is the round exception.',
  'Field is most of the screen. Paper is where you read. Ember is the action. Cite blue is the reference.',
  'Text on ember is field ink. Paper or white on ember fails contrast.',
  'Paths, hashes, statuses and eyebrows are mono and tracked.',
  'Motion uses the duration and easing tokens. Reduced motion stops it.',
  'A number beats an adjective. A finding without file:line is not shown as a finding.',
];

export function Foundations() {
  return (
    <div className="doc">
      <DesignNav current="/design/foundations" />
      <header className="doc-title">
        <div>
          <p className="eyebrow">OmniSwarm design system · v1 · Foundations</p>
          <h1 className="display">Source Mark</h1>
          <p className="lede">
            A review instrument. Dark field, paper for the thing you read, ember when you act,
            cite blue when you point at a line. Nothing here certifies that code is safe.
          </p>
        </div>
        <div className="principles">
          <div className="box"><div className="label">01 Plates</div><p className="muted">Chamfered corners. The live dot is the only circle.</p></div>
          <div className="box"><div className="label">02 Signal</div><p className="muted">Ember acts, about 10%. Cite blue refers, about 5%.</p></div>
          <div className="box"><div className="label">03 Evidence</div><p className="muted">Mono for paths, hashes and statuses. Cite the line.</p></div>
          <div className="box"><div className="label">04 Field</div><p className="muted">Dark first. Paper plates are for reading.</p></div>
        </div>
      </header>

      <section>
        <div className="sec-row"><h2 className="h2">Color</h2><span className="label">4 core · ratio 60 / 25 / 10 / 5</span></div>
        <div className="core-swatches">
          <div className="core-swatch plate sw-field"><div className="name">Field</div><div className="spec">--os-field<br />Backgrounds and text on ember<br />about 60%</div></div>
          <div className="core-swatch plate sw-paper"><div className="name">Paper</div><div className="spec">--os-paper<br />Reading plates and secondary buttons<br />about 25%</div></div>
          <div className="core-swatch plate sw-ember"><div className="name">Ember</div><div className="spec">--os-ember<br />Primary action. Field ink on top<br />about 10%</div></div>
          <div className="core-swatch plate sw-cite"><div className="name">Cite</div><div className="spec">--os-cite<br />Links, systems, the other family<br />about 5%</div></div>
        </div>
        <div className="support-swatches">
          <Swatch name="Deep" cls="sw-deep" />
          <Swatch name="Plate" cls="sw-plate" />
          <Swatch name="Seam" cls="sw-seam" />
          <Swatch name="Steel" cls="sw-steel" />
          <Swatch name="Ember hi" cls="sw-ember-hi" />
          <Swatch name="Ember ink" cls="sw-ember-ink" />
          <Swatch name="Cite hi" cls="sw-cite-hi" />
          <Swatch name="Verified" cls="sw-ok" />
          <Swatch name="Fault" cls="sw-fault" />
          <Swatch name="Warn" cls="sw-warn" />
        </div>
        <div className="contrast">
          <div className="pair-ok-ember"><b>Aa 6.3</b><span>Field on ember</span></div>
          <div className="pair-ok-cite"><b>Aa 5.3</b><span>White on cite</span></div>
          <div className="pair-ok-cite-hi"><b>Aa 9.4</b><span>Cite hi on field</span></div>
          <div className="pair-ok-steel"><b>Aa 7.8</b><span>Steel on field</span></div>
          <div className="pair-ok-ink"><b>Aa 6.4</b><span>Ember ink on paper</span></div>
          <div>
            <div className="pair-bad" aria-hidden="true" style={{ minHeight: 36 }} />
            <b>Aa 3.1</b>
            <span className="label">Never paper on ember</span>
          </div>
        </div>
      </section>

      <section>
        <div className="sec-row"><h2 className="h2">Type</h2><span className="label">Sora · Source Sans 3 · IBM Plex Mono</span></div>
        <div className="cols-3">
          <div className="font-card plate"><div className="aa display">Aa</div><div className="fname">Sora</div><p>Display and headings. 600–700. Sentence case for the product title.</p></div>
          <div className="font-card plate"><div className="aa" style={{ fontFamily: 'var(--os-font-body)' }}>Aa</div><div className="fname">Source Sans 3</div><p>Body and UI copy. 15–19px. Sentence case.</p></div>
          <div className="font-card plate"><div className="aa mono">Aa</div><div className="fname">IBM Plex Mono</div><p>Telemetry: eyebrows, labels, paths, hashes, statuses.</p></div>
        </div>
        <div className="type-scale">
          <div className="type-row"><span className="label">Display</span><span className="display">Sign the verdict</span></div>
          <div className="type-row"><span className="label">H1</span><span className="h1">Four stages, then a hash</span></div>
          <div className="type-row"><span className="label">H2</span><span className="h2">What you can run today</span></div>
          <div className="type-row"><span className="label">H3</span><span className="h3">File and line</span></div>
          <div className="type-row"><span className="label">Eyebrow</span><span className="eyebrow">03 · Example</span></div>
          <div className="type-row"><span className="label">Product H1</span><span className="h1">A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR</span></div>
          <div className="type-row"><span className="label">Body L</span><span className="lede">Independent models review a public repository and a judge writes the general review.</span></div>
          <div className="type-row"><span className="label">Readout</span><span className="readout c-ember">2 <small className="label">passes</small> · <span className="c-cite">40</span></span></div>
          <div className="type-row"><span className="label">Label</span><span className="label">src/lib.rs:30 · disputed</span></div>
        </div>
      </section>

      <section>
        <div className="sec-row"><h2 className="h2">Voice</h2><span className="label">Short · concrete · no certificate</span></div>
        <div className="cols-3">
          <div className="variant plate"><span className="label">Hero · swarm</span><p className="say">Several models. One cited report.</p></div>
          <div className="variant v-cite plate"><span className="label">Hero · evidence</span><p className="say">If it has no line number, it is not a finding.</p></div>
          <div className="variant v-paper plate"><span className="label">Hero · hash</span><p className="say">The report has a hash. Recompute it here.</p></div>
        </div>
        <div className="cols-4">
          <div className="voice"><span className="label">System</span><p>Review queued. 3 reviewers, 2 passes, 40 tool calls each.</p></div>
          <div className="voice judge"><span className="label">Judge</span><p>One disputed finding remains. Quotes disagree.</p></div>
          <div className="voice alert"><span className="label">Alert</span><p>The review cannot run. Nothing was charged.</p></div>
          <div className="voice"><span className="label">Report</span><p>Model agreement does not certify security. The report says what was checked.</p></div>
        </div>
        <div className="cols-4">
          <span className="btn btn-primary">Review a repo</span>
          <span className="btn btn-system">Open the sample</span>
          <span className="btn btn-secondary">Read the rules</span>
          <span className="btn btn-ghost">Start over</span>
        </div>
        <p className="dim">Buttons are verbs. Body is sentence case. Use numbers. Never say a passing suite makes the repository safe.</p>
      </section>

      <section>
        <div className="sec-row"><h2 className="h2">Plates</h2><span className="label">Chamfer 8 · 14 · 24</span></div>
        <div className="motifs">
          <div className="plate-sm sw-paper">Plate S · chips and inputs</div>
          <div className="plate sw-plate">Plate M · cards and buttons</div>
          <div className="plate-lg sw-ember">Plate L · hero frames</div>
          <div className="brackets plate">HUD brackets</div>
          <div className="hazard plate-sm" />
          <div className="hazard-cite plate-sm" />
          <div className="rivets plate">Rivet grid</div>
        </div>
        <div className="icons">
          <Icon label="Review"><path d="M4 6h16M4 12h10M4 18h14" /></Icon>
          <Icon label="Cite"><path d="M7 4v16M7 4h8l-2 4 2 4H7" /></Icon>
          <Icon label="Debate"><path d="M4 8h8v6H7L4 17V8zM12 10h8v6h-3l-3 3v-3" /></Icon>
          <Icon label="Judge"><path d="M12 4v3M6 8h12l-1 6H7L6 8zM8 19h8" /></Icon>
          <Icon label="Verify"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" /></Icon>
          <Icon label="Sandbox"><path d="M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4 8-4V8" /></Icon>
          <Icon label="Hash"><path d="M9 4L7 20M17 4l-2 16M4 9h16M5 15h16" /></Icon>
          <Icon label="Near"><path d="M5 17l7-12 7 12H5z" /></Icon>
        </div>
      </section>

      <section>
        <div className="sec-row"><h2 className="h2">Spacing and glow</h2><span className="label">4px base</span></div>
        <div className="spacing">
          {[4, 8, 12, 16, 24, 32, 48, 64, 96].map((px, index) => (
            <div key={px}><i style={{ height: px }} /><span>S{index + 1}</span></div>
          ))}
        </div>
        <div className="glows">
          <div className="g1">Glow 1 · ember</div>
          <div className="g2">Glow 2 · cite</div>
          <div className="g3">Glow 3 · action</div>
        </div>
      </section>

      <section>
        <div className="sec-row"><h2 className="h2">Rules</h2><span className="label">Same discipline on every page</span></div>
        <ol className="rule-list">
          {RULES.map((rule, index) => (
            <li key={rule}><span className="label">0{index + 1}</span><span>{rule}</span></li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Swatch({ name, cls }: { name: string; cls: string }) {
  return (
    <div>
      <div className={`chipc ${cls}`} />
      <div className="meta">{name}</div>
    </div>
  );
}

function Icon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{children}</svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
