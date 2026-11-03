import Link from 'next/link';

export const HERO = 'A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR';

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <h1 id="hero-title" className="hero__title">{HERO}</h1>
      <p className="hero__lead">
        Independent models review a public GitHub repository, debate each other with cited evidence, and a judge writes the
        general review. The report hash is attested on NEAR so anyone can check it was not changed.
      </p>
      <div className="hero__actions">
        <a className="button button--primary" href="#review">Review a repo</a>
        <Link className="button button--secondary" href="/sample">View a sample report</Link>
      </div>
    </section>
  );
}
