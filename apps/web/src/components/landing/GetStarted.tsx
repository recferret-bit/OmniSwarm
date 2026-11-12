import Link from 'next/link';

const STEPS = [
  { k: '01', title: 'Sign in', body: 'Google, X or a NEAR wallet. No password to create.' },
  { k: '02', title: 'Paste your key', body: 'Save your NEAR AI Cloud API key on the dashboard. It is stored encrypted and shown only as a fingerprint.' },
  { k: '03', title: 'Pick models', body: 'Choose up to six NEAR AI models. The first one orchestrates; every one reviews.' },
  { k: '04', title: 'Submit', body: 'Name a public GitHub repository and the scope. The report lands in your review history.' },
];

/** The landing call to action: the cloud runs only on the visitor's own NEAR AI key, and the local CLI stays free. */
export function GetStarted() {
  return (
    <section className="land-section" id="start" aria-labelledby="start-title">
      <div className="container-wide">
        <header className="land-head">
          <p className="land-kicker"><i>07</i><span className="eyebrow">Start</span></p>
          <h2 id="start-title" className="h2">Review in the cloud with your own NEAR AI key</h2>
          <p className="lede">
            OmniSwarm charges nothing. You pay NEAR AI directly for the model calls, and reviewed source is sent to NEAR AI Cloud under
            your key.
          </p>
        </header>
        <ol className="start-steps">
          {STEPS.map((step) => (
            <li className="card plate" key={step.k}>
              <p className="label c-ember">{step.k}</p>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="hero-actions">
          <Link className="btn btn-primary btn-lg" href="/dashboard">Open the dashboard</Link>
        </div>
        <div className="start-local">
          <h3>Or run it on your machine</h3>
          <p>Every installed CLI (Claude, Codex, Grok, AGY) reviews under your own logins. Nothing to sign up for.</p>
          <pre><code>./bin/audit local</code></pre>
        </div>
      </div>
    </section>
  );
}
