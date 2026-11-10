import type { Progress, ProgressDetail } from '@/lib/api/schema.gen';
import { Pill, type Tone } from '../ui/Pill';

// The engine's live snapshot, shared by the request page (/r/[id]) and the local review page (/local).
// Everything shown comes from one snapshot, so a reload or the polling fallback shows the same thing as the
// live stream. A session with no agent activity for STALL_MS is called out; nothing here stops it.
export const STALL_MS = 120_000;

const PHASE_LABEL: Record<string, string> = {
  prepare: 'Preparing sandbox', tests: 'Existing tests', review: 'Review', crosscheck: 'Cross-check', debate: 'Debate',
  adjudicate: 'Adjudication', 'general-review': 'General review', report: 'Report', starting: 'Starting', themes: 'Themes',
};
const THEME_LABEL: Record<string, string> = { web3: 'Web3', apps: 'Apps', infra: 'Infra', scripts: 'Scripts' };
const STATE_LABEL: Record<ProgressDetail['state'], string> = {
  running: 'Running', finished: 'Finished', incomplete: 'Finished with gaps', failed: 'Stopped by an error', cancelled: 'Cancelled',
};
const STATE_TONE: Record<ProgressDetail['state'], Tone> = { running: 'info', finished: 'good', incomplete: 'warn', failed: 'bad', cancelled: 'bad' };

export function phaseLabel(phase: string): string {
  return PHASE_LABEL[phase] ?? phase;
}

export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes >= 1) return `${minutes}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 1000)}s`;
}

type Reviewer = NonNullable<ProgressDetail['reviewers']>[number];
type RunState = ProgressDetail['state'];

// The request (or local job) status is the authority once it is final. A snapshot still saying "running" then
// is a run that was killed before it could record its end, so it is never shown as live.
const FINAL_STATUS: Record<string, RunState> = { failed: 'failed', refunded: 'failed', expired: 'cancelled', done: 'finished' };
export function displayState(detail: RunState, status?: string): RunState {
  return detail === 'running' && status && FINAL_STATUS[status] ? FINAL_STATUS[status] : detail;
}

function reviewerStatus(row: Reviewer, live: boolean): { text: string; tone: Tone } {
  if (row.state === 'done') return { text: 'Done', tone: 'good' };
  if (row.state === 'failed') return { text: 'Failed', tone: 'bad' };
  if (!live) return { text: 'Stopped', tone: 'neutral' };
  if (row.state === 'pending') return { text: 'Waiting', tone: 'neutral' };
  if ((row.idleMs ?? 0) >= STALL_MS) return { text: `No activity for ${duration(row.idleMs ?? 0)}`, tone: 'warn' };
  return { text: 'Working', tone: 'info' };
}

function Reviewers({ rows, live }: { rows: Reviewer[]; live: boolean }) {
  return (
    <table className="progress__reviewers">
      <caption>Reviewers</caption>
      <thead><tr><th scope="col">Reviewer</th><th scope="col">Status</th><th scope="col">Pass</th><th scope="col">Tool calls</th><th scope="col">Jobs</th></tr></thead>
      <tbody>
        {rows.map((row) => {
          const status = reviewerStatus(row, live);
          return (
            <tr key={row.id}>
              <th scope="row" className="progress__id">{row.id}{row.surface ? <span className="progress__surface"> {row.surface}</span> : null}</th>
              <td data-label="Status"><Pill tone={status.tone}>{status.text}</Pill></td>
              <td data-label="Pass">{row.pass ? `${row.pass} of ${row.passes}` : row.state === 'done' ? `${row.passes} of ${row.passes}` : '—'}</td>
              <td data-label="Tool calls">{row.calls !== undefined && row.budget ? `${row.calls} of ${row.budget}` : '—'}</td>
              <td data-label="Jobs">{row.jobsDone} of {row.jobs}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Sessions that are not a reviewer's own job (cross-check, debate turns, judgements). A count while they run,
// and each one with no agent activity for STALL_MS called out, so a stuck provider shows in every phase.
function Sessions({ rows }: { rows: NonNullable<ProgressDetail['sessions']> }) {
  const stalled = rows.filter((row) => row.idleMs >= STALL_MS);
  return (
    <div className="progress__sessions">
      <p className="progress__counts">Sessions running: {rows.length}</p>
      {stalled.length ? (
        <ul className="reviewers" aria-label="Stalled sessions">
          {stalled.map((row) => (
            <li key={row.id} className="reviewers__row">
              <span className="reviewers__id">{row.id}</span>
              <Pill tone="warn">No activity for {duration(row.idleMs)}</Pill>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Themes({ rows }: { rows: NonNullable<ProgressDetail['themes']> }) {
  return (
    <ul className="reviewers" aria-label="Themes">
      {rows.map((row) => (
        <li key={row.theme} className="reviewers__row">
          <span className="reviewers__id">{THEME_LABEL[row.theme] ?? row.theme}</span>
          <span>{row.status === 'done' ? 'Done' : row.phase ? phaseLabel(row.phase) : row.status === 'queued' ? 'Queued' : row.status}</span>
          <span>{Math.round(row.percent ?? 0)}%</span>
        </li>
      ))}
    </ul>
  );
}

// status: the request's or local job's own status, which overrides a snapshot that never recorded its end.
export function ProgressPanel({ progress, status }: { progress: Progress; status?: string }) {
  const detail = progress.detail;
  const percent = Math.round(progress.percent ?? 0);
  const state = detail ? displayState(detail.state, status) : 'running';
  const running = state === 'running';
  const head = [
    `${percent}%`,
    running ? phaseLabel(progress.phase) : STATE_LABEL[state],
    detail?.elapsedMs !== undefined ? `${duration(detail.elapsedMs)} elapsed` : null,
  ].filter(Boolean).join(' · ');
  const debate = detail?.debate;
  return (
    <section className="progress" aria-label="Live progress">
      {/* Not a live region: the elapsed time changes on every update. The request status is announced elsewhere. */}
      <p className="progress__head">
        {/* While running, the request's own status pill already says so; the run's state is shown once it ends. */}
        {detail && !running ? <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill> : null} {head}
      </p>
      <progress max={100} value={percent} aria-label="Review progress" aria-valuetext={head} />
      {detail?.phases.length ? (
        <ol className="progress__phases" aria-label="Review phases">
          {detail.phases.map((row) => (
            <li key={row.name} className={`is-${row.state === 'running' && !running ? 'failed' : row.state}`} aria-current={row.state === 'running' && running ? 'step' : undefined}>
              {phaseLabel(row.name)}<span className="visually-hidden">: {row.state}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {detail?.themes?.length ? <Themes rows={detail.themes} /> : null}
      {detail?.reviewers?.length ? <Reviewers rows={detail.reviewers} live={running} /> : null}
      {running && detail?.sessions?.length ? <Sessions rows={detail.sessions} /> : null}
      {detail?.crosscheck?.total ? <p className="progress__counts">Cross-checks done: {detail.crosscheck.done} of {detail.crosscheck.total}</p> : null}
      {debate && (debate.clusters || debate.toJudge) ? (
        <p className="progress__counts">
          {debate.clusters ? `Clusters debated: ${debate.heard ?? 0} of ${debate.clusters}` : null}
          {debate.clusters && debate.toJudge ? ' · ' : null}
          {debate.toJudge ? `Judged: ${debate.judged ?? 0} of ${debate.toJudge}` : null}
        </p>
      ) : null}
    </section>
  );
}
