'use client';

import { useState } from 'react';
import { REPO_URL } from '../ui/SiteFooter';
import { HowStage } from './HowStage';
import './how.css';

const STEPS = [
  { title: 'Independent reviewers', body: 'Two reviewers by default, up to six, read one sealed snapshot, two passes of 40 calls each. The picture walks the contract, the edge config, and the app. A hit stays a lead until a reviewer cites the line.', anchor: 'reviewers' },
  { title: 'Anonymized debate', body: 'The orchestrator assigns the floor. Names become Reviewer A, B, and C, duplicate reports fold into one cluster, and a challenge with no citation is dropped.', anchor: 'debate' },
  { title: 'Judge and general review', body: 'When the orchestrator shares a vendor with an author, an alternate judge takes that cluster. The status cannot rise above the cited evidence. The orchestrator then writes the general review.', anchor: 'adjudication' },
  { title: 'Verify the hash', body: 'findings-and-scores.json and general-review.json are canonicalized and hashed, and the service publishes that report_sha256 with the report. Your browser fetches the same files and recomputes the digest, so you see whether the report you read is the report that was published. The hash detects edits; it does not make a finding true.', anchor: 'report-hash' },
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
          <p className="lede">Pick a stage. The picture moves through it: two reviewers by default, up to six, on one sealed snapshot, the orchestrator running debate and the write-up, then the report hash you can recompute in your browser.</p>
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
