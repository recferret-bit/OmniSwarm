'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PipelineSummary } from '@/lib/api/schema.gen';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Pill, type Tone } from '../ui/Pill';

function ratingTone(rating: NonNullable<PipelineSummary['advice']>['qualityRating']): Tone {
  if (rating === 'strong') return 'good';
  if (rating === 'adequate') return 'info';
  if (rating === 'degraded') return 'warn';
  return 'bad';
}

export function PipelinePanel({
  pipeline,
  incomplete,
  canContinue = false,
  onAdvise,
  onContinue,
}: {
  pipeline?: PipelineSummary | null;
  incomplete?: boolean;
  canContinue?: boolean;
  onAdvise?: () => Promise<void>;
  onContinue?: (rounds: number) => Promise<void>;
}) {
  const recommendedRounds = pipeline?.advice?.recommendedRounds;
  const defaultRounds = Math.max(1, Math.min(3, recommendedRounds || 1));
  const [rounds, setRounds] = useState<number>(defaultRounds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (recommendedRounds !== undefined) {
      setRounds(Math.max(1, Math.min(3, recommendedRounds || 1)));
    }
  }, [recommendedRounds]);

  if (!pipeline && !incomplete) return null;

  const notes = pipeline?.incompletionNotes ?? [];
  const advice = pipeline?.advice;
  const followUps = pipeline?.nextRoundRequestIds ?? [];

  const handleAdvise = async () => {
    if (!onAdvise || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdvise();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not queue Step 2 orchestrator advice.');
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = async () => {
    if (!onContinue || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onContinue(rounds);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not queue the next debate round.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pipeline-panel" aria-label="Pipeline status and advice">
      {pipeline ? (
        <p className="request-row">
          {pipeline.noDebates ? (
            <Pill tone="info">STAGE 1 — NO DEBATES</Pill>
          ) : pipeline.roundsCompleted > 0 ? (
            <Pill tone="good">Debate round {pipeline.roundsCompleted}</Pill>
          ) : (
            <Pill tone="neutral">Mode: {pipeline.pipelineMode}</Pill>
          )}
          {incomplete || notes.length > 0 ? <Pill tone="warn">Incomplete ({notes.length || 1})</Pill> : null}
        </p>
      ) : incomplete ? (
        <p className="request-row"><Pill tone="warn">Incomplete</Pill></p>
      ) : null}

      {advice ? (
        <div className="pipeline-advice">
          <p>
            <strong>Frontier orchestrator advice:</strong>{' '}
            <Pill tone={ratingTone(advice.qualityRating)}>Quality: {advice.qualityRating}</Pill>{' '}
            <Pill tone={advice.debateNeeded ? 'warn' : 'good'}>
              {advice.debateNeeded
                ? `Debate recommended: ${advice.recommendedDepth} (${advice.recommendedRounds} round${advice.recommendedRounds === 1 ? '' : 's'})`
                : 'Debate not required'}
            </Pill>
          </p>
          <p className="muted">{advice.summary}</p>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <div className="pipeline-incompletion">
          <p><strong>Why this audit is incomplete &amp; security impact:</strong></p>
          <ul>
            {notes.map((note, idx) => (
              <li key={`${note.code}-${note.source}-${idx}`}>
                <strong>{note.category} ({note.code} · {note.source}):</strong> {note.reason}{' '}
                <span className="muted">Impact: {note.impact}</span>
                {note.nextStep ? <span className="muted"> Next: {note.nextStep}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {followUps.length > 0 ? (
        <p className="muted">
          Follow-up pipeline steps:{' '}
          {followUps.map((childId, idx) => (
            <span key={childId}>
              {idx > 0 ? ', ' : ''}
              <Link href={`/r/${childId}`}>Step #{idx + 1}</Link>
            </span>
          ))}
        </p>
      ) : null}

      {canContinue && onAdvise && pipeline && !advice && pipeline.roundsCompleted === 0 ? (
        <div className="flow-step">
          <Button type="button" busy={busy} onClick={() => void handleAdvise()}>
            Run Step 2 orchestrator advice
          </Button>
        </div>
      ) : null}

      {canContinue && onContinue && pipeline?.canRunMoreRounds ? (
        <div className="flow-step">
          <fieldset className="quote-form">
            <legend>Run iterative debate rounds</legend>
            {([1, 2, 3] as const).map((count) => (
              <label key={count}>
                <input
                  type="radio"
                  name="debate-rounds"
                  value={count}
                  checked={rounds === count}
                  onChange={() => setRounds(count)}
                />
                {' '}{count} round{count === 1 ? '' : 's'}
              </label>
            ))}
          </fieldset>
          <Button type="button" busy={busy} onClick={() => void handleContinue()}>
            Run next debate round
          </Button>
        </div>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
