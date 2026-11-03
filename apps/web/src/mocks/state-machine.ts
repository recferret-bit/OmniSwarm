// Dev/e2e only. The request lifecycle as a pure function of time since payment:
// awaiting_payment -> queued -> running -> publishing -> done, or, with the
// REVIEW_FAILED control, running -> failed -> refunded (INTAKE section 4).
import type { Progress, Status } from '@/lib/api/schema.gen';
import type { MockRequest } from './db';

export const REVIEWERS = ['cli-claude-opus', 'key-zai-glm-5-3', 'openrouter-qwen-qwen3-8-max'] as const;
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

function runningProgress(elapsed: number): Progress {
  let step = Math.min(RUN_STEPS - 1, Math.floor(elapsed / STEP_MS));
  const percent = Math.round(((step + 1) / RUN_STEPS) * 100);
  const reviewIndex = PHASES.indexOf('review');
  if (step < reviewIndex) return { phase: PHASES[step]!, percent };
  step -= reviewIndex;
  if (step < REVIEWERS.length * 2) {
    const pass = step < REVIEWERS.length ? 1 : 2;
    return { phase: 'review', reviewer: REVIEWERS[step % REVIEWERS.length]!, pass, percent };
  }
  const phase = PHASES[reviewIndex + 1 + step - REVIEWERS.length * 2]!;
  return phase === 'debate' ? { phase, pass: 2, percent } : { phase, percent };
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
