'use client';

import { useState } from 'react';
import { REPO_URL } from '../ui/SiteFooter';
import { HowStage } from './HowStage';
import './how.css';

const STEPS = [
  { title: 'Independent reviewers', body: 'Several model families review the code in an offline sandbox, each with fixed passes and a tool budget.', anchor: 'reviewers' },
  { title: 'Anonymized debate', body: 'Reviewers challenge each other’s findings with cited source evidence; unsupported claims are refuted.', anchor: 'debate' },
  { title: 'Judge and general review', body: 'A cross-family judge adjudicates each disputed finding and writes the general review.', anchor: 'adjudication' },
  { title: 'Attested on NEAR', body: 'The report hash is written to the review-registry contract; this site recomputes it in your browser.', anchor: 'attestation' },
] as const;

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const step = STEPS[active] ?? STEPS[0];
  return (
    <section className="land-section" id="how" aria-labelledby="how-title">
      <div className="container-wide">
        <header className="land-head">
          <p className="land-kicker"><i>02</i><span className="eyebrow">How it works</span></p>
          <h2 id="how-title" className="h2">Four stages, then a hash</h2>
          <p className="lede">Pick a stage. The picture is that stage of one review: a cited line, a challenge, a ruling, then the hash.</p>
        </header>
        <HowStage active={active} />
        <div className="pipeline" role="tablist" aria-label="Review stages">
          {STEPS.map((item, index) => (
            <button
              key={item.title}
              type="button"
              className="radio-card plate"
              role="tab"
              id={`how-tab-${index}`}
              aria-selected={index === active}
              aria-controls="how-panel"
              tabIndex={index === active ? 0 : -1}
              onClick={() => setActive(index)}
            >
              <span className="label c-ember">0{index + 1}</span>
              <span className="h3">{item.title}</span>
            </button>
          ))}
        </div>
        <div className="how-detail card plate" role="tabpanel" id="how-panel" aria-labelledby={`how-tab-${active}`}>
          <h3>{step.title}</h3>
          <p className="lede">{step.body}</p>
          <p><a href={`${REPO_URL}/blob/main/docs/RULES.md#${step.anchor}`}>Rules for this stage</a></p>
        </div>
      </div>
    </section>
  );
}
