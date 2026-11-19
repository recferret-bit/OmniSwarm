import Link from 'next/link';
import { HeroCanvas } from './StageCanvas';

export const HERO = 'A swarm of AI reviewers for NEAR contracts and NEAR AI code, then a report you can verify';

const STATS = [
  { label: 'Panel', value: 'You choose', note: 'Models on your own NEAR AI key' },
  { label: 'Each pass', value: '40 calls', note: '2 passes, then submit' },
  { label: 'Report hash', value: '1 hash', note: 'Recomputed in your browser' },
  { label: 'Sandbox', value: 'Offline', note: 'No network inside the review' },
];

export function Hero() {
  return (
    <section className="hero-stage" aria-labelledby="hero-title">
      <HeroCanvas />
      <div className="hero-stage__shade" aria-hidden="true" />
      <div className="container-wide hero-stage__copy">
        <p className="eyebrow">NEAR contracts · NEAR AI · Offline sandbox</p>
        <h1 id="hero-title" className="display">{HERO}</h1>
        <p className="lede">
          Pick a NEAR repository: a contract, a wallet client, Intents, or a NEAR AI app, and the application around it.
          A panel you choose, on your own NEAR AI key, reviews it in an offline sandbox against the security-audit skill,
          then debates each finding with cited evidence. You get a report whose hash you can verify in the browser.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary btn-lg" href="#start">Review a repo</a>
          <Link className="btn btn-secondary btn-lg" href="/sample">View a sample report</Link>
        </div>
        <ol className="hero-stats" aria-label="Review facts">
          {STATS.map((stat, index) => (
            <li className="card plate" key={stat.label}>
              <span className="hero-stats__i">0{index + 1}</span>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
              <em>{stat.note}</em>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
