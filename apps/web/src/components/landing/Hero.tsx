import Link from 'next/link';
import { HeroCanvas } from './StageCanvas';

export const HERO = 'A swarm of AI reviewers that argue over your code, then publish a report you can verify';

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
        <p className="eyebrow">Your own NEAR AI key · Offline sandbox · File and line</p>
        <h1 id="hero-title" className="display">{HERO}</h1>
        <p className="lede">
          Pick a repository. A panel of AI models you choose, running on your own NEAR AI key, reviews it in an offline
          sandbox, cross-checks and debates each finding with cited evidence, and a judge writes the general review. You get a
          report whose hash you can verify in the browser.
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
