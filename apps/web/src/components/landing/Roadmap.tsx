import { FlipFlow, type FlowStep } from './FlipFlow';

const LATER: FlowStep[] = [
  {
    title: 'Mainnet registry',
    lead: 'Same attest and refund methods, after testnet is the one people use.',
    detail: 'The contract methods do not change. Mainnet waits until the testnet flow has been the one people actually use.',
  },
  {
    title: 'Public cost ledger',
    lead: 'A published cost per run. The report keeps a fingerprint, never the key.',
    detail: 'Reports already store the first and last four characters of the key hash. The ledger would publish the cost, not the secret.',
  },
  {
    title: 'De-anonymize toggle',
    lead: 'An explicit switch. The default round stays anonymized.',
    detail: 'Turn it on to show which model wrote which side of a debate. Off, the round hides the author.',
  },
  {
    title: 'NEAR AI attestation',
    lead: 'Check NEAR AI Cloud\'s TEE attestation before a key is used.',
    detail: 'Reviews on your NEAR AI key run today. OmniSwarm does not yet verify the TEE attestation, so it does not call those reviews private.',
  },
  {
    title: 'GitHub Action',
    lead: 'Start a review from a workflow on a repo you may review.',
    detail: 'The engine stays offline either way. The action does not widen reviewer tools or the network.',
  },
  {
    title: 'Publish the guard',
    lead: 'Another signer can refuse a payment when the hash drifted.',
    detail: 'Ship the guard so a missing attestation or a drifted code hash stops the payment.',
  },
  {
    title: 'Social login',
    lead: 'A session that is not the sample operator account.',
    detail: 'The wallet signature on a paid request stays. Login does not replace it.',
  },
];

export function Roadmap() {
  return (
    <section className="land-section" id="roadmap" aria-labelledby="roadmap-title">
      <div className="container-wide">
        <header className="land-head">
          <p className="land-kicker"><i>05</i><span className="eyebrow">Later</span></p>
          <h2 id="roadmap-title" className="h2">Not in this build</h2>
          <p className="lede">None of these is switched on. Hover a card. It flips.</p>
        </header>
        <FlipFlow steps={LATER} tone="later" label="Deferred work" />
      </div>
    </section>
  );
}
