import { Stat, StatGrid } from '../ui/Stat';

export function Pricing() {
  return (
    <section className="land-section" id="pricing" aria-labelledby="pricing-title">
      <div className="container-wide">
        <header className="land-head">
          <p className="land-kicker"><i>07</i><span className="eyebrow">Pricing</span></p>
          <h2 id="pricing-title" className="h2">Pricing</h2>
        </header>
        <StatGrid label="Hosted review">
          <Stat label="Price" value="1 NEAR (testnet)" />
          <Stat label="Reviewers" value="3 hosted model families" />
          <Stat label="Budget" value="2 passes × 40 tool calls" />
        </StatGrid>
        <p className="lede">
          You pay through the review-registry contract. If the review cannot run (sandbox, provider outage or timeout), the deposit is
          refunded on chain. A completed review is not refunded. Testnet only during the hackathon.
        </p>
      </div>
    </section>
  );
}
