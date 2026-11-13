import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import type { VerificationState } from './useVerification';

interface Props {
  state: VerificationState;
  // A sample compares against a hash recorded with this site, not one served for a request.
  sample?: boolean;
  onRecheck?: () => void;
}

function verdict(state: VerificationState): { tone: 'good' | 'bad' | 'warn' | 'neutral'; label: string } {
  if (state.phase === 'checking') return { tone: 'neutral', label: 'Checking the report hash…' };
  if (state.phase === 'error') return { tone: 'warn', label: `Could not check the report: ${state.message}` };
  if (state.result.state === 'unhashed') return { tone: 'warn', label: 'No published hash to compare with' };
  if (state.result.state === 'mismatch') return { tone: 'bad', label: 'Report hash does not match' };
  return { tone: 'good', label: 'Report hash matches' };
}

/** The in-browser check: the published report files are hashed here and compared with the hash the service serves. */
export function HashBadge({ state, sample = false, onRecheck }: Props) {
  const { tone, label } = verdict(state);
  const result = state.phase === 'done' ? state.result : null;
  return (
    <div className={`hashcheck hashcheck--${tone}`} role="status" aria-live="polite">
      <p className="hashcheck__verdict"><Pill tone={tone}>{label}</Pill></p>
      {sample ? <p className="hashcheck__note">Compared with a sample hash bundled with this site.</p> : null}
      {result ? (
        <dl className="hashcheck__hashes">
          <dt>Recomputed in your browser</dt><dd><code data-testid="report-hash">{result.computed}</code></dd>
          <dt>{sample ? 'Recorded sample hash' : 'Hash served for this report'}</dt>
          <dd><code data-testid="served-hash">{result.state === 'unhashed' ? 'none' : result.expected}</code></dd>
        </dl>
      ) : null}
      {onRecheck ? <Button variant="ghost" onClick={onRecheck} disabled={state.phase === 'checking'}>Verify again</Button> : null}
    </div>
  );
}
