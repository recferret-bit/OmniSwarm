import { FlipFlow, type FlowStep } from './FlipFlow';

const NOW: FlowStep[] = [
  {
    title: 'Local CLIs',
    lead: 'Every CLI on PATH. Opus orchestrates when claude is installed.',
    detail: 'audit local runs every installed CLI. Claude Opus orchestrates when claude is on PATH. One installed CLI does both jobs.',
  },
  {
    title: 'Hosted panel',
    lead: 'GLM 5.3 orchestrates. Qwen reviews. Two workers, one job each.',
    detail: 'Optional add-ons: Opus 5.5, Sol 6.1, Argon 4, Grok 4.7. The worker decrypts a provider key only for that spawn.',
  },
  {
    title: 'Dashboard and admin',
    lead: 'Sample account starts a review. Admin stores a fingerprint, never the key.',
    detail: 'The sample account is operator / operator and does not take a NEAR payment. The admin page is nginx basic auth, outside the public header.',
  },
  {
    title: 'Large repositories',
    lead: 'A big tree splits by theme: web3, apps, infra, scripts.',
    detail: 'You get one report per theme and an index that links them. The review stays offline either way.',
  },
  {
    title: 'Waves landed',
    lead: 'W00 through W14 are on main, through the guard.',
    detail: 'That run covers the reviewer registry, the sandbox, the intake API, the testnet contract, this app, and the guard.',
  },
  {
    title: 'Testnet price',
    lead: '1 NEAR. Refunded only when the review cannot run.',
    detail: 'A finished review is not refunded. The deposit moves on the testnet registry, and the report hash is what you can check.',
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
