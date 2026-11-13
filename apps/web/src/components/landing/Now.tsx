import { FlipFlow, type FlowStep } from './FlipFlow';

const NOW: FlowStep[] = [
  {
    title: 'Local CLIs',
    lead: 'Every CLI on PATH. Opus orchestrates when claude is installed.',
    detail: 'audit local runs every installed CLI. Claude Opus orchestrates when claude is on PATH. One installed CLI does both jobs.',
  },
  {
    title: 'Your NEAR AI key',
    lead: 'The cloud runs on your own NEAR AI Cloud key. Pick the models.',
    detail: 'The first model orchestrates and every model reviews. The worker decrypts your key only for that spawn; the report records a fingerprint.',
  },
  {
    title: 'Dashboard and admin',
    lead: 'Sign in with Google, X, or a NEAR wallet, then start a review.',
    detail: 'The dashboard is its own page and holds your key as a fingerprint. Admin shows jobs only, behind nginx basic auth.',
  },
  {
    title: 'Large repositories',
    lead: 'A big tree splits by theme: web3, apps, infra, scripts.',
    detail: 'You get one report per theme and an index that links them. The review stays offline either way.',
  },
  {
    title: 'Waves landed',
    lead: 'W00 through W14 are on main.',
    detail: 'That run covers the reviewer catalog, the offline sandbox, the intake API and this app.',
  },
  {
    title: 'Free',
    lead: 'OmniSwarm charges nothing. You pay NEAR AI directly.',
    detail: 'Model calls are billed to your own NEAR AI account. The report hash is published with the report, so anyone can check it in the browser.',
  },
];

export function Now() {
  return (
    <section className="land-section" id="now" aria-labelledby="now-title">
      <div className="container-wide">
        <header className="land-head">
          <p className="land-kicker"><i>04</i><span className="eyebrow">Current state</span></p>
          <h2 id="now-title" className="h2">What you can run today</h2>
          <p className="lede">Hover a card. It flips.</p>
        </header>
        <FlipFlow steps={NOW} tone="shipped" label="What ships today" />
      </div>
    </section>
  );
}
