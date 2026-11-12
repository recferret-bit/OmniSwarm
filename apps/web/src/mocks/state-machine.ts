// Dev/e2e only. The request lifecycle as a pure function of time since payment:
// awaiting_payment -> queued -> running -> publishing -> done, or, with the
// REVIEW_FAILED control, running -> failed -> refunded (INTAKE section 4).
import type { Progress, Status } from '@/lib/api/schema.gen';
import type { MockRequest } from './db';

export const REVIEWERS = ['cli-claude-opus', 'nearai-deepseek-ai-deepseek-v4', 'nearai-qwen-qwen3-8-max'] as const;
export const PHASES = ['prepare', 'tests', 'review', 'cross-check', 'debate', 'adjudicate', 'general review', 'publish'] as const;

export const STEP_MS = 600;
const QUEUED_MS = 900;
// review runs one step per reviewer and pass (3 reviewers x 2 passes).
const RUN_STEPS = PHASES.length - 2 + REVIEWERS.length * 2;
const RUNNING_MS = RUN_STEPS * STEP_MS;
const PUBLISH_MS = 900;
export const DONE_AFTER_MS = QUEUED_MS + RUNNING_MS + PUBLISH_MS;
const FAIL_AT_MS = QUEUED_MS + 4 * STEP_MS;
const REFUND_AT_MS = FAIL_AT_MS + 900;

export interface Snapshot {
  status: Status;
  progress?: Progress;
}

// The engine's phase names (orchestrator-progress.mjs) for the mock's display names.
const ENGINE_PHASE: Record<string, NonNullable<Progress['detail']>['phases'][number]['name']> = {
  prepare: 'prepare', tests: 'tests', review: 'review', 'cross-check': 'crosscheck', debate: 'debate',
  adjudicate: 'adjudicate', 'general review': 'general-review', publish: 'report',
};

// The live snapshot the real worker passes through: phase states, and each reviewer's pass and calls.
function detailAt(phase: string, elapsed: number, reviewing: { reviewer: string; pass: number } | null): NonNullable<Progress['detail']> {
  const at = PHASES.indexOf(phase as (typeof PHASES)[number]);
  const reviewIndex = PHASES.indexOf('review');
  const order = REVIEWERS.indexOf(reviewing?.reviewer as (typeof REVIEWERS)[number]);
  return {
    state: 'running', elapsedMs: elapsed,
    phases: PHASES.map((name, index) => ({ name: ENGINE_PHASE[name]!, state: index < at ? 'done' : index === at ? 'running' : 'pending' })),
    reviewers: REVIEWERS.map((id, index) => {
      const behind = at > reviewIndex || (reviewing && (reviewing.pass === 2 || index < order));
      if (at < reviewIndex) return { id, state: 'pending', jobsDone: 0, jobs: 1, passes: 2 };
      if (behind && !(reviewing && reviewing.pass === 2 && index >= order)) return { id, state: 'done', jobsDone: 1, jobs: 1, passes: 2 };
      const pass = reviewing && index === order ? reviewing.pass : reviewing && reviewing.pass === 2 ? 2 : 1;
      return { id, state: 'running', jobsDone: 0, jobs: 1, passes: 2, pass, calls: index === order ? 18 : 4, budget: 40, surface: 'S1', idleMs: 4_000 };
    }),
    ...(at >= PHASES.indexOf('debate') ? { debate: { clusters: 3, heard: at > PHASES.indexOf('debate') ? 3 : 1 } } : {}),
  };
}

function runningProgress(elapsed: number): Progress {
  let step = Math.min(RUN_STEPS - 1, Math.floor(elapsed / STEP_MS));
  const percent = Math.round(((step + 1) / RUN_STEPS) * 100);
  const reviewIndex = PHASES.indexOf('review');
  if (step < reviewIndex) return { phase: PHASES[step]!, percent, detail: detailAt(PHASES[step]!, elapsed, null) };
  step -= reviewIndex;
  if (step < REVIEWERS.length * 2) {
    const pass = step < REVIEWERS.length ? 1 : 2;
    const reviewer = REVIEWERS[step % REVIEWERS.length]!;
    return { phase: 'review', reviewer, pass, percent, detail: detailAt('review', elapsed, { reviewer, pass }) };
  }
  const phase = PHASES[reviewIndex + 1 + step - REVIEWERS.length * 2]!;
  const detail = detailAt(phase, elapsed, null);
  return phase === 'debate' ? { phase, pass: 2, percent, detail } : { phase, percent, detail };
}

export function snapshotAt(request: MockRequest, now: number): Snapshot {
  if (request.paidAt === null) return { status: 'awaiting_payment' };
  const elapsed = now - request.paidAt;
  if (elapsed < QUEUED_MS) return { status: 'queued' };
  if (request.fails) {
    if (elapsed >= REFUND_AT_MS) return { status: 'refunded' };
    if (elapsed >= FAIL_AT_MS) return { status: 'failed', progress: { phase: 'review' } };
  }
  if (elapsed < QUEUED_MS + RUNNING_MS) return { status: 'running', progress: runningProgress(elapsed - QUEUED_MS) };
  if (elapsed < DONE_AFTER_MS) return { status: 'publishing', progress: { phase: 'publish', percent: 100 } };
  return { status: 'done' };
}
