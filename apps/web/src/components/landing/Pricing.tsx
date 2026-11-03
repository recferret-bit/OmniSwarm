import { Panel } from '../ui/Panel';
import { Stat, StatGrid } from '../ui/Stat';

export function Pricing() {
  return (
    <Panel id="pricing" title="Pricing">
      <StatGrid label="Hosted review">
        <Stat label="Price" value="1 NEAR (testnet)" />
        <Stat label="Reviewers" value="3 hosted model families" />
        <Stat label="Budget" value="2 passes × 40 tool calls" />
      </StatGrid>
      <p>
        You pay through the review-registry contract. If the review cannot run (sandbox, provider outage or timeout), the deposit is
        refunded on chain. A completed review is not refunded. Testnet only during the hackathon.
      </p>
    </Panel>
  );
}
