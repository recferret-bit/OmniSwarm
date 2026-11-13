import { render, screen, within } from '@testing-library/react';
import { validate } from '@omniswarm/schemas';
import { describe, expect, it, vi } from 'vitest';
import { api, type LocalJobDetail } from '@/lib/api/client';
import type { Progress, ProgressDetail } from '@/lib/api/schema.gen';
import { snapshotAt, DONE_AFTER_MS, STEP_MS } from '@/mocks/state-machine';
import { LocalJobs } from '../local/LocalJobs';
import { displayState, duration, ProgressPanel, STALL_MS } from './ProgressPanel';

const head = () => document.querySelector('.progress__head') as HTMLElement;

const PHASES = ['prepare', 'tests', 'review', 'crosscheck', 'debate', 'adjudicate', 'general-review', 'report'] as const;
const phases = (running: string, failed = false): ProgressDetail['phases'] => {
  const at = PHASES.indexOf(running as (typeof PHASES)[number]);
  return PHASES.map((name, i) => ({ name, state: i < at ? 'done' : i === at ? (failed ? 'failed' : 'running') : failed ? 'skipped' : 'pending' }));
};
const progress = (detail: Partial<ProgressDetail>, percent = 46, phase = 'review'): Progress => ({
  phase, percent, detail: { state: 'running', elapsedMs: 2_789_000, phases: phases(phase), ...detail },
});

describe('<ProgressPanel>', () => {
  it('shows the percent, the running phase, elapsed time, and each reviewer with pass and calls', () => {
    render(<ProgressPanel progress={progress({
      reviewers: [
        { id: 'cli-claude-opus', state: 'done', jobsDone: 1, jobs: 1, passes: 2 },
        { id: 'cli-grok-grok-4-7', state: 'running', jobsDone: 0, jobs: 1, passes: 2, pass: 1, calls: 31, budget: 40, surface: 'S3', idleMs: 4_000 },
        { id: 'cli-agy', state: 'pending', jobsDone: 0, jobs: 1, passes: 2 },
      ],
    })} />);
    expect(head()).toHaveTextContent('46% · Review · 46m 29s elapsed');
    expect(screen.getByRole('progressbar', { name: 'Review progress' })).toHaveAttribute('value', '46');
    const phaseList = screen.getByRole('list', { name: 'Review phases' });
    expect(within(phaseList).getAllByRole('listitem')).toHaveLength(8);
    expect(within(phaseList).getByText('Review').closest('li')).toHaveAttribute('aria-current', 'step');
    const table = screen.getByRole('table', { name: 'Reviewers' });
    const grok = within(table).getByRole('row', { name: /cli-grok-grok-4-7/ });
    expect(grok).toHaveTextContent('Working');
    expect(grok).toHaveTextContent('1 of 2');
    expect(grok).toHaveTextContent('31 of 40');
    expect(within(table).getByRole('row', { name: /cli-claude-opus/ })).toHaveTextContent('Done2 of 2');
    expect(within(table).getByRole('row', { name: /cli-agy/ })).toHaveTextContent('Waiting');
  });

  it('calls out a reviewer with no agent activity, and only past the stall threshold', () => {
    const row = (idleMs: number) => ({ id: 'cli-grok-grok-4-7', state: 'running' as const, jobsDone: 0, jobs: 1, passes: 2, pass: 1, calls: 31, budget: 40, idleMs });
    const { unmount } = render(<ProgressPanel progress={progress({ reviewers: [row(STALL_MS + 65_000)] })} />);
    expect(screen.getByRole('row', { name: /cli-grok/ })).toHaveTextContent('No activity for 3m 5s');
    unmount();
    render(<ProgressPanel progress={progress({ reviewers: [row(STALL_MS - 1)] })} />);
    expect(screen.getByRole('row', { name: /cli-grok/ })).toHaveTextContent('Working');
  });

  it('never presents a run that stopped as finished', () => {
    for (const [state, label] of [['incomplete', 'Finished with gaps'], ['failed', 'Stopped by an error'], ['cancelled', 'Cancelled']] as const) {
      const { unmount } = render(<ProgressPanel progress={{ phase: 'debate', percent: 80, detail: { state, phases: phases('debate', true) } }} />);
      expect(head()).toHaveTextContent(`80% · ${label}`);
      expect(head()).not.toHaveTextContent('Finished ·');
      expect(screen.getByText('Debate').closest('li')).toHaveClass('is-failed');
      expect(screen.getByText('Report').closest('li')).toHaveClass('is-skipped');
      unmount();
    }
    render(<ProgressPanel progress={{ phase: 'report', percent: 100, detail: { state: 'finished', phases: phases('report').map((p) => ({ ...p, state: 'done' as const })) } }} />);
    expect(head()).toHaveTextContent('100% · Finished');
  });

  it('trusts a final request status over a snapshot that never recorded its end', () => {
    const live = progress({ reviewers: [{ id: 'cli-grok-grok-4-7', state: 'running', jobsDone: 0, jobs: 1, passes: 2, pass: 1, calls: 31, budget: 40, idleMs: 1_000 }] });
    for (const [status, label] of [['failed', 'Stopped by an error'], ['done', 'Finished']] as const) {
      const { unmount } = render(<ProgressPanel progress={live} status={status} />);
      expect(head()).toHaveTextContent(`46% · ${label}`);
      expect(screen.getByRole('row', { name: /cli-grok/ })).toHaveTextContent('Stopped');
      expect(screen.queryByText('Working')).toBeNull();
      expect(screen.getByText('Review').closest('li')).not.toHaveAttribute('aria-current');
      unmount();
    }
    // While the request is still running (or publishing), the snapshot's own state stands.
    for (const status of ['running', 'publishing', undefined]) {
      const { unmount } = render(<ProgressPanel progress={live} status={status} />);
      expect(screen.getByRole('row', { name: /cli-grok/ })).toHaveTextContent('Working');
      unmount();
    }
    expect(displayState('incomplete', 'done')).toBe('incomplete');
    expect(displayState('finished', 'failed')).toBe('finished');
  });

  it('counts running sessions and calls out a stalled one, only while the run is live', () => {
    const detail = { sessions: [{ id: 'crosscheck-cli-claude-opus', idleMs: 4_000 }, { id: 'cli-grok-grok-4-7-debate-cluster-3-r1-devil', idleMs: STALL_MS + 65_000 }] };
    const { unmount } = render(<ProgressPanel progress={progress(detail, 74, 'crosscheck')} />);
    expect(screen.getByText('Sessions running: 2')).toBeInTheDocument();
    const stalled = screen.getByRole('list', { name: 'Stalled sessions' });
    expect(within(stalled).getAllByRole('listitem')).toHaveLength(1);
    expect(stalled).toHaveTextContent('cli-grok-grok-4-7-debate-cluster-3-r1-devil');
    expect(stalled).toHaveTextContent('No activity for 3m 5s');
    unmount();
    // Nothing is stalled: the count alone. The run has ended: neither.
    const calm = render(<ProgressPanel progress={progress({ sessions: [{ id: 'crosscheck-cli-claude-opus', idleMs: 4_000 }] }, 74, 'crosscheck')} />);
    expect(screen.getByText('Sessions running: 1')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Stalled sessions' })).toBeNull();
    calm.unmount();
    render(<ProgressPanel progress={progress(detail, 74, 'crosscheck')} status="failed" />);
    expect(screen.queryByText(/Sessions running/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Stalled sessions' })).toBeNull();
  });

  it('shows cross-check and debate counts, and the themes of a split review', () => {
    const { unmount } = render(<ProgressPanel progress={progress({ crosscheck: { done: 1, total: 3 }, debate: { clusters: 4, heard: 2, judged: 1, toJudge: 4 } }, 84, 'adjudicate')} />);
    expect(screen.getByText('Cross-checks done: 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Clusters debated: 2 of 4 · Judged: 1 of 4')).toBeInTheDocument();
    unmount();
    render(<ProgressPanel progress={{ phase: 'themes', percent: 45, detail: { state: 'running', phases: [], themes: [
      { theme: 'web3', status: 'running', phase: 'review', percent: 35 }, { theme: 'apps', status: 'done', percent: 100 }, { theme: 'infra', status: 'queued', percent: 0 },
    ] } }} />);
    const themes = screen.getByRole('list', { name: 'Themes' });
    expect(within(themes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Web3Review35%', 'AppsDone100%', 'InfraQueued0%']);
    expect(screen.queryByRole('table', { name: 'Reviewers' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Review phases' })).toBeNull();
  });

  it('formats durations for seconds, minutes and hours', () => {
    expect([duration(5_400), duration(185_000), duration(3_725_000)]).toEqual(['5s', '3m 5s', '1h 2m']);
  });
});

describe('the mock request lifecycle', () => {
  it('carries a schema-valid live detail at every step of a run', () => {
    const request = { startedAt: 0, fails: false } as never;
    let seen = 0;
    for (let t = 0; t < DONE_AFTER_MS; t += STEP_MS / 2) {
      const snap = snapshotAt(request, t);
      if (!snap.progress?.detail) continue;
      seen += 1;
      const check = validate('intake-api#progress-event', { status: snap.status, progress: snap.progress, at: '2026-11-10T12:00:00Z' });
      expect(check.errors).toEqual([]);
      expect(snap.progress.detail.phases.filter((p) => p.state === 'running')).toHaveLength(1);
    }
    expect(seen).toBeGreaterThan(10);
  });
});

describe('<LocalJobs> with live progress', () => {
  const job = (status: string, withProgress: boolean): LocalJobDetail => ({
    id: `00000000-0000-4000-8000-00000000000${status.length}`, kind: 'path', source: `/repos/${status}`, status, createdAt: '2026-11-10T12:00:00Z',
    ref: null, commitSha: null, error: null, pdfReady: false,
    ...(withProgress ? { progress: progress({ reviewers: [{ id: 'cli-codex', state: 'running', jobsDone: 0, jobs: 1, passes: 2, pass: 2, calls: 7, budget: 40 }] }) } : {}),
  });

  it('shows the panel for a running job and leaves a finished or queued job as one line', async () => {
    const jobs = [job('running', true), job('done', true), job('queued', false)];
    vi.spyOn(api, 'listLocalJobs').mockResolvedValue({ jobs });
    vi.spyOn(api, 'getLocalJob').mockImplementation(async (id) => jobs.find((row) => row.id === id)!);
    render(<LocalJobs />);
    const running = (await screen.findByText('/repos/running')).closest('li')!;
    expect(within(running).getByRole('progressbar', { name: 'Review progress' })).toBeInTheDocument();
    expect(within(running).getByRole('row', { name: /cli-codex/ })).toHaveTextContent('7 of 40');
    expect(within(screen.getByText('/repos/done').closest('li')!).queryByRole('progressbar')).toBeNull();
    expect(within(screen.getByText('/repos/queued').closest('li')!).queryByRole('progressbar')).toBeNull();
  });
});
