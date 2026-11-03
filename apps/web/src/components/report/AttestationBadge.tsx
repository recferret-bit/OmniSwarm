import { txUrl } from '@/lib/near/explorer';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { BindingStatus } from './BindingStatus';
import type { VerificationState } from './useVerification';

interface Props {
  state: VerificationState;
  // A sample compares against a recorded fixture, never against the chain.
  sample?: boolean;
  attestTx?: string;
  onRecheck?: () => void;
}

function verdict(state: VerificationState, sample: boolean): { tone: 'good' | 'bad' | 'warn' | 'neutral'; label: string } {
  if (state.phase === 'checking') return { tone: 'neutral', label: 'Checking attestation…' };
  if (state.phase === 'error') return { tone: 'warn', label: `Could not verify the report: ${state.message}` };
  if (state.result.state === 'unattested') return { tone: 'warn', label: 'No attestation found on chain for this request' };
  if (state.result.state === 'mismatch') return { tone: 'bad', label: 'hash does not match the attestation' };
  return { tone: 'good', label: sample ? 'Attested (sample)' : 'hash matches on-chain attestation' };
}

export function AttestationBadge({ state, sample = false, attestTx, onRecheck }: Props) {
  const { tone, label } = verdict(state, sample);
  const result = state.phase === 'done' ? state.result : null;
  return (
    <div className={`attestation attestation--${tone}`} role="status" aria-live="polite">
      <p className="attestation__verdict"><Pill tone={tone}>{label}</Pill></p>
      {sample ? <p className="attestation__note">Compared with a recorded sample attestation bundled with this site, not read from NEAR.</p> : null}
      {result ? (
        <dl className="attestation__hashes">
          <dt>Recomputed in your browser</dt><dd><code data-testid="report-hash">{result.computed}</code></dd>
          <dt>{sample ? 'Recorded attestation' : 'On-chain attestation'}</dt>
          <dd><code data-testid="attested-hash">{result.state === 'unattested' ? 'none' : result.attestation.report_sha256}</code></dd>
        </dl>
      ) : null}
      {result && result.state !== 'unattested' ? <BindingStatus attestation={result.attestation} /> : null}
      {attestTx && !sample ? <p><a href={txUrl(attestTx)} target="_blank" rel="noreferrer">View the attest transaction</a></p> : null}
      {onRecheck ? <Button variant="ghost" onClick={onRecheck} disabled={state.phase === 'checking'}>Verify again</Button> : null}
    </div>
  );
}
