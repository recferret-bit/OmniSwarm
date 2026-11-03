// One `review` job (W09-12..16): running -> engine -> classify -> publish -> attest, or failed ->
// refund. Re-entrant: pg-boss re-delivers a job whose worker died (missed heartbeat) and the handler
// resumes from what the database, the attempt dirs and the contract already show.
import type { ChainPort, Severity } from '../chain/port.ts';
import type { Config } from '../config/load.ts';
import type { Pool } from '../db/pool.ts';
import { findRequest, transition, type RequestRow } from '../db/repositories/requests.ts';
import type { EngineRunner } from '../engine/port.ts';
import {
  attestRequest, beginPublishing, markFailed, markRunningOnChain, refundRequest,
} from '../modules/payments/settlement.service.ts';
import type { ReviewJob } from '../queue/review-queue.ts';
import type { Clock } from '../shared/clock.ts';
import { isAppError } from '../shared/errors.ts';
import type { Logger } from '../shared/logger.ts';
import { attemptDirs, completedAttempt, recordResult, runCostUsd } from './attempts.ts';
import { classify, type Outcome } from './classify.ts';
import { ProgressTailer } from './progress-tailer.ts';
import { publishReport, readPublished } from './publish.ts';
import { maxSeverity } from './report.ts';

export interface HandlerDeps { config: Config; pool: Pool; clock: Clock; chain: ChainPort; engine: EngineRunner; log: Logger }
/** `lastAttempt`: this delivery has no retry left. `signal`: the worker is stopping (or lost the claim). */
export interface JobContext { lastAttempt: boolean; signal: AbortSignal }

/** Thrown to make pg-boss retry the job (engine error with retries left). */
export class RetryJobError extends Error {
  override name = 'RetryJobError';
}

/** The run was stopped by the worker (shutdown) before it produced a result: release, do not settle. */
export class RunInterruptedError extends Error {
  override name = 'RunInterruptedError';
}

export type HandlerResult =
  | { status: 'done' | 'incomplete'; reportSha256: string; maxSeverityConfirmed: string; reportDir: string; costUsd: number }
  | { status: 'refunded' | 'failed' | 'skipped'; reason: string };

function reportUrl(config: Config, requestId: string): string {
  return `${config.storage.reportsBaseUrl}/${requestId}/report.html`;
}

async function attest(deps: HandlerDeps, row: RequestRow, sourceDir: string | null, incomplete: boolean): Promise<HandlerResult> {
  if (row.status === 'running') {
    const published = sourceDir
      ? publishReport({ reportsRoot: deps.config.storage.reportsRoot, requestId: row.id, sourceDir, repo: row.repo, commitSha: row.commit_sha, preset: row.preset })
      : readPublished(deps.config.storage.reportsRoot, row.id);
    if (!published) throw new Error(`request ${row.id} has no published report to attest`);
    row = await beginPublishing(deps, row.id, {
      reportSha256: published.reportSha256, reportUri: reportUrl(deps.config, row.id), maxSeverity: maxSeverity(published.dir), incomplete,
    });
  }
  await attestRequest(deps, row.id, { reportUri: row.report_url ?? reportUrl(deps.config, row.id), maxSeverity: (row.max_severity ?? 'none') as Severity });
  const dir = readPublished(deps.config.storage.reportsRoot, row.id)?.dir ?? '';
  return {
    status: row.incomplete ? 'incomplete' : 'done', reportSha256: row.report_sha256 ?? '', maxSeverityConfirmed: row.max_severity ?? 'none',
    reportDir: dir, costUsd: dir ? runCostUsd(dir) : 0,
  };
}

async function refund(deps: HandlerDeps, row: RequestRow, cause: string): Promise<HandlerResult> {
  if (row.status !== 'failed') await markFailed(deps, row.id, cause);
  await refundRequest(deps, row.id, { actor: 'worker', cause });
  deps.log.info({ requestId: row.id, cause }, 'review refunded');
  return { status: 'refunded', reason: cause };
}

async function runEngine(deps: HandlerDeps, row: RequestRow, attempt: number, signal: AbortSignal): Promise<{ outcome: Outcome; out: string }> {
  const dirs = attemptDirs(deps.config.storage.runsRoot, row.id, attempt);
  const abort = new AbortController();
  const onStop = () => abort.abort();
  signal.addEventListener('abort', onStop, { once: true });
  // A shutdown that landed before the listener existed must still stop this run.
  if (signal.aborted) onStop();
  const tailer = new ProgressTailer(deps, row.id, dirs.out, onStop);
  tailer.start(deps.config.progressPollMs);
  try {
    const result = await deps.engine.run({ repo: row.repo, commitSha: row.commit_sha, preset: row.preset, outDir: dirs.out, logPath: dirs.log }, abort.signal);
    recordResult(dirs, result);
    return { outcome: classify(result, dirs.out), out: dirs.out };
  } finally {
    signal.removeEventListener('abort', onStop);
    await tailer.stop();
  }
}

async function settle(deps: HandlerDeps, row: RequestRow, outcome: Outcome, out: string, ctx: JobContext): Promise<HandlerResult> {
  const { lastAttempt } = ctx;
  switch (outcome.kind) {
    case 'completed':
      return attest(deps, row, out, outcome.incomplete);
    case 'infra_failed':
      return refund(deps, row, outcome.cause);
    case 'engine_error':
      if (!lastAttempt) throw new RetryJobError(`engine error (${outcome.cause}); retrying`);
      return refund(deps, row, `engine_error_after_retry:${outcome.cause}`);
    case 'operator_error':
      if (!lastAttempt) throw new RetryJobError(`engine could not start (${outcome.cause}); retrying`);
      // Fail closed: not the user's fault and not a review result. An operator decides on the refund.
      await markFailed(deps, row.id, `operator:${outcome.cause}`);
      deps.log.error({ requestId: row.id, cause: outcome.cause }, 'ALERT engine cannot be started; request left failed for an operator');
      return { status: 'failed', reason: outcome.cause };
    case 'aborted': {
      const fresh = await findRequest(deps.pool, row.id);
      if (fresh?.status === 'refunded') return { status: 'skipped', reason: 'refunded while running' };
      throw new RunInterruptedError('run interrupted by worker shutdown');
    }
  }
}

/** Resume a request that an earlier delivery left part-way, or start it. */
export async function handleReview(deps: HandlerDeps, job: ReviewJob, ctx: JobContext): Promise<HandlerResult> {
  let row = await findRequest(deps.pool, job.requestId);
  if (!row || row.request_hash !== job.requestHash) return { status: 'skipped', reason: 'job does not match a request' };
  if (row.status === 'done' || row.status === 'refunded' || row.status === 'expired') return { status: 'skipped', reason: row.status };
  if (row.status === 'publishing') return attest(deps, row, null, Boolean(row.incomplete));
  if (row.status === 'failed') {
    if (row.failure_cause?.startsWith('operator:')) return { status: 'failed', reason: row.failure_cause };
    return refund(deps, row, row.failure_cause ?? 'infra');
  }
  // Attempts count engine runs started for this request, across deliveries and released jobs alike.
  const attempt = row.attempts;
  row = await transition(deps.pool, row.id, {
    to: 'running', patch: { attempts: attempt + 1 }, actor: 'worker', event: 'review_started', data: { attempt: attempt + 1 }, now: deps.clock.now(),
  });
  const earlier = completedAttempt(deps.config.storage.runsRoot, row.id);
  // A crash after publishing but before the status write: attest the published report.
  if (readPublished(deps.config.storage.reportsRoot, row.id)) return attest(deps, row, null, earlier?.incomplete ?? false);
  if (!(await markRunningOnChain(deps, row))) {
    await transition(deps.pool, row.id, { to: 'refunded', actor: 'worker', event: 'review_refunded', data: { cause: 'refunded_on_chain' }, now: deps.clock.now() });
    return { status: 'refunded', reason: 'refunded_on_chain' };
  }
  // A crash after the engine finished but before publishing: publish that run instead of re-running.
  if (earlier) return attest(deps, row, earlier.out, earlier.incomplete);
  if (ctx.signal.aborted) throw new RunInterruptedError('worker shutdown before the engine started');
  const { outcome, out } = await runEngine(deps, row, attempt, ctx.signal);
  try {
    return await settle(deps, row, outcome, out, ctx);
  } catch (error) {
    // An admin refunded the request while it ran: nothing left to do.
    if (isAppError(error, 'INVALID_TRANSITION') && (await findRequest(deps.pool, row.id))?.status === 'refunded') {
      return { status: 'skipped', reason: 'refunded while running' };
    }
    throw error;
  }
}

/** A job that exhausted its retries (its worker died each time): infra failure unless the report exists. */
export async function handleDeadReview(deps: HandlerDeps, job: ReviewJob): Promise<HandlerResult> {
  const row = await findRequest(deps.pool, job.requestId);
  if (!row || row.request_hash !== job.requestHash) return { status: 'skipped', reason: 'job does not match a request' };
  if (row.status === 'done' || row.status === 'refunded' || row.status === 'expired') return { status: 'skipped', reason: row.status };
  if (row.status === 'publishing' || (row.status === 'running' && readPublished(deps.config.storage.reportsRoot, row.id))) return attest(deps, row, null, false);
  if (row.status === 'failed' && row.failure_cause?.startsWith('operator:')) return { status: 'failed', reason: row.failure_cause };
  return refund(deps, row, row.failure_cause ?? 'worker_lost');
}
