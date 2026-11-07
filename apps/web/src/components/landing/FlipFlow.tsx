'use client';

import { useState } from 'react';
import './flow-cards.css';

export interface FlowStep { title: string; lead: string; detail: string }

export function FlipFlow({ steps, tone, label }: { steps: readonly FlowStep[]; tone: 'shipped' | 'later'; label: string }) {
  const [pinned, setPinned] = useState<number | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  return (
    <ol className="flip-flow" aria-label={label}>
      {steps.map((step, index) => {
        const open = hot === index || pinned === index;
        return (
          <li key={step.title}>
            <button
              type="button"
              aria-expanded={open}
              onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHot(index); }}
              onPointerLeave={() => setHot((current) => (current === index ? null : current))}
              onFocus={() => setHot(index)}
              onBlur={() => setHot((current) => (current === index ? null : current))}
              onClick={() => setPinned((current) => (current === index ? null : index))}
            >
              <span className="flip-flow__card">
                <span className="flip-flow__face">
                  <span className="flip-flow__top">
                    <span className="label">0{index + 1}</span>
                    <span className={tone === 'shipped' ? 'badge badge-ok' : 'badge badge-later'}>{tone === 'shipped' ? 'Shipped' : 'Later'}</span>
                  </span>
                  <span className="h3">{step.title}</span>
                  <span className="lead">{step.lead}</span>
                </span>
                <span className="flip-flow__back">
                  <span className="label">0{index + 1} · {step.title}</span>
                  <p>{step.detail}</p>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
