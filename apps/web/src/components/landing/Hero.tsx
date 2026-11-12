import Link from 'next/link';
import { HeroCanvas } from './StageCanvas';

export const HERO = 'A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR';

const STATS = [
  { label: 'Families', value: '4 CLIs', note: 'Claude, Codex, Grok, AGY' },
  { label: 'Each pass', value: '40 calls', note: '2 passes, then submit' },
  { label: 'Attestation', value: '1 hash', note: 'Written on NEAR testnet' },
  { label: 'Sandbox', value: 'Offline', note: 'No network inside the review' },
];

export function Hero() {
  return (
    <section className="hero-stage" aria-labelledby="hero-title">
      <HeroCanvas />
      <div className="hero-stage__shade" aria-hidden="true" />
      <div className="container-wide hero-stage__copy">
        <p className="eyebrow">NEAR testnet · Offline sandbox · File and line</p>
        <h1 id="hero-title" className="display">{HERO}</h1>
        <p className="lede">
          Independent models review a public GitHub repository, debate each other with cited evidence, and a judge writes the
          general review. The report hash is attested on NEAR so anyone can check it was not changed.
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
