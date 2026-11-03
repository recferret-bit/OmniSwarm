import { REPO_URL } from '../ui/SiteFooter';
import { Panel } from '../ui/Panel';

const STEPS = [
  { title: 'Independent reviewers', body: 'Several model families review the code in an offline sandbox, each with fixed passes and a tool budget.', anchor: 'reviewers' },
  { title: 'Anonymized debate', body: 'Reviewers challenge each other’s findings with cited source evidence; unsupported claims are refuted.', anchor: 'debate' },
  { title: 'Judge and general review', body: 'A cross-family judge adjudicates each disputed finding and writes the general review.', anchor: 'adjudication' },
  { title: 'Attested on NEAR', body: 'The report hash is written to the review-registry contract; this site recomputes it in your browser.', anchor: 'attestation' },
] as const;

function Diagram() {
  return (
    <svg className="how__diagram" viewBox="0 0 400 60" role="img" aria-labelledby="how-diagram-title">
      <title id="how-diagram-title">Reviewers, then debate, then judge, then on-chain attestation</title>
      {STEPS.map((step, index) => (
        <g key={step.title} transform={`translate(${index * 100 + 10} 10)`}>
          <rect width="80" height="40" rx="8" className="how__node" />
          <text x="40" y="25" textAnchor="middle" className="how__label">{index + 1}</text>
          {index < STEPS.length - 1 ? <path d="M82 20 H98" className="how__edge" /> : null}
        </g>
      ))}
    </svg>
  );
}

export function HowItWorks() {
  return (
    <Panel id="how" title="How it works">
      <Diagram />
      <ol className="how__steps">
        {STEPS.map((step) => (
          <li key={step.title}>
            <h3>{step.title}</h3>
            <p>{step.body} <a href={`${REPO_URL}/blob/main/RULES.md#${step.anchor}`}>Rules</a></p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
