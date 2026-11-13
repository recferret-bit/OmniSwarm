const FEATURES = [
  { k: '01', title: 'One bridge', body: 'Every reviewer reads a sealed snapshot through the same MCP methods. Arbitrary commands, exploits and live probes are refused.' },
  { k: '02', title: 'File and line', body: 'A finding counts when it cites the line. A regex hit in the lead scan stays a lead until a reviewer cites the control.' },
  { k: '03', title: 'Anonymized debate', body: 'Reviewers challenge each other’s claims with source evidence. Unsupported claims are refuted. The round hides who said it.' },
  { k: '04', title: 'A judge from another family', body: 'A cross-family judge rules on each disputed cluster. The orchestrator then writes the general review.' },
  { k: '05', title: 'A hash you can check', body: 'The service publishes a hash of the report files. This site recomputes that hash in your browser and says whether it matches.' },
  { k: '06', title: 'Their tests, not ours', body: 'The runner executes the repository’s own catalogued tests. A green suite is evidence about that suite, not a safety certificate.' },
];

export function Features() {
  return (
    <section className="land-section" id="features" aria-labelledby="features-title">
      <div className="container-wide">
        <header className="land-head">
          <p className="land-kicker"><i>01</i><span className="eyebrow">Features</span></p>
          <h2 id="features-title" className="h2">What the swarm actually does</h2>
          <p className="lede">Six constraints. They are the product, not a coat of paint on a single model.</p>
        </header>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <article className="card plate feature-card" key={feature.k}>
              <p className="label c-ember">{feature.k}</p>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
