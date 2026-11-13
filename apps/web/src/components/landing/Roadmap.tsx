import { FlipFlow, type FlowStep } from './FlipFlow';

const LATER: FlowStep[] = [
  {
    title: 'Cost in the report',
    lead: 'Show what a run cost, next to the findings. The report keeps a fingerprint, never the key.',
    detail: 'Reports already store a fingerprint of the key that ran them. A cost line would show the spend, not the secret.',
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
    title: 'More sign-in providers',
    lead: 'Another way to sign in besides Google, X and a NEAR wallet.',
    detail: 'Sign-in only picks the account that owns your NEAR AI key and your review history. It never moves funds.',
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
