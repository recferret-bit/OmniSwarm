'use client';

import type { PipelineMode } from '@/lib/api/schema.gen';

export const PIPELINE_MODE_CHOICES: ReadonlyArray<readonly [PipelineMode, string, string]> = [
  ['full', 'Full run', 'Stage 1 pass, frontier advice and multi-agent debates in one run.'],
  ['step-by-step', 'Step-by-step', 'Stage 1 pass and frontier orchestrator advice first; run debate rounds when you choose.'],
  ['stage-1', 'Stage 1 only (no debates)', 'Fast multi-agent pass and stored evidence without debate rounds.'],
];

export function parseSavedPipelineMode(raw: string | null): PipelineMode {
  if (raw === 'step-by-step' || raw === 'stage-1' || raw === 'full') return raw;
  return 'full';
}

export function PipelineModeChecks({
  value,
  onChange,
  name = 'pipelineMode',
}: {
  value: PipelineMode;
  onChange: (next: PipelineMode) => void;
  name?: string;
}) {
  return (
    <fieldset className="quote-form">
      <legend>Pipeline mode</legend>
      <p className="muted">Choose whether to run the full pipeline immediately or pause after Stage 1 for iterative debate rounds.</p>
      {PIPELINE_MODE_CHOICES.map(([mode, label, hint]) => (
        <label key={mode}>
          <input
            type="radio"
            name={name}
            value={mode}
            checked={value === mode}
            onChange={() => onChange(mode)}
          />
          {' '}{label}
          <span className="muted"> — {hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
