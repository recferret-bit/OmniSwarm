// One `review` job (W09-12..16): running -> engine -> classify -> publish -> done, or failed. Re-entrant:
// pg-boss re-delivers a job whose worker died (missed heartbeat) and the handler resumes from what the
// database and the attempt dirs already show.
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../config/load.ts';
import type { Pool } from '../db/pool.ts';
import { findRequest, transition, type RequestRow } from '../db/repositories/requests.ts';
import type { EngineRunner } from '../engine/port.ts';
import type { ReviewJob } from '../queue/review-queue.ts';
import type { Clock } from '../shared/clock.ts';
import type { Logger } from '../shared/logger.ts';
import { recordRequestCost } from '../db/repositories/costs.ts';
import { attemptDirs, completedAttempt, recordResult } from './attempts.ts';
import { classify, type Outcome } from './classify.ts';
import { requestCost } from './cost.ts';
import { ProgressTailer } from './progress-tailer.ts';
import { publishReport, readPublished } from './publish.ts';
import { maxSeverity } from './report.ts';
import { beginPublishing, finishRequest, markFailed } from './settle.ts';
import { ensureReportPdf } from '../shared/report-pdf.ts';
import { accountPresetProvider, providerById } from '@omniswarm/schemas/providers';
import { readAccountKey } from '../modules/providers/account-keys.ts';
import { accountConfigDocument } from './account-config.ts';

export interface HandlerDeps { config: Config; pool: Pool; clock: Clock; engine: EngineRunner; log: Logger }
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
  | { status: 'failed' | 'skipped'; reason: string };

function reportUrl(config: Config, requestId: string): string {
  return `${config.storage.reportsBaseUrl}/${requestId}/report.html`;
}

/** Sum every attempt's model cost into request_cost (W09-18) before the request settles. */
async function recordCost(deps: HandlerDeps, requestId: string): Promise<number> {
  const cost = requestCost(deps.config.storage.runsRoot, requestId);
  await recordRequestCost(deps.pool, requestId, cost, deps.clock.now());
  return cost.costUsd;
}

/** Publish the finished run (once) and mark the request done. Resumable from `running` or `publishing`. */
async function publish(deps: HandlerDeps, row: RequestRow, sourceDir: string | null, incomplete: boolean): Promise<HandlerResult> {
  const costUsd = await recordCost(deps, row.id);
  if (row.status === 'running') {
    // Copied by publishReport. Do not chmod here; the publisher seals the tree.
    if (sourceDir) ensureReportPdf(sourceDir, deps.config.engine.root);
    const published = sourceDir
      ? publishReport({ reportsRoot: deps.config.storage.reportsRoot, requestId: row.id, sourceDir, repo: row.repo, commitSha: row.commit_sha, preset: row.preset })
      : readPublished(deps.config.storage.reportsRoot, row.id);
    if (!published) throw new Error(`request ${row.id} has no published report to finish`);
    row = await beginPublishing(deps, row.id, {
      reportSha256: published.reportSha256, reportUrl: reportUrl(deps.config, row.id), maxSeverity: maxSeverity(published.dir), incomplete,
    });
  }
  row = await finishRequest(deps, row.id);
  const dir = readPublished(deps.config.storage.reportsRoot, row.id)?.dir ?? '';
  return {
    status: row.incomplete ? 'incomplete' : 'done', reportSha256: row.report_sha256 ?? '', maxSeverityConfirmed: row.max_severity ?? 'none',
    reportDir: dir, costUsd,
  };
}

async function fail(deps: HandlerDeps, row: RequestRow, cause: string): Promise<HandlerResult> {
  await recordCost(deps, row.id);
  if (row.status !== 'failed') await markFailed(deps, row.id, cause);
  deps.log.info({ requestId: row.id, cause }, 'review failed');
  return { status: 'failed', reason: cause };
}

interface Prepared { configFile?: string; providerEnv: Record<string, string>; providerScope?: string[] }

/**
 * Keys and config for one run, per the provider catalog. An `account-<provider>` job runs on the requesting
 * account's own key and the models snapshotted on its row; the spawn carries only that provider's variables
 * (providerScope). There are no operator-held provider keys to decrypt.
 */
export async function prepareProviders(deps: Pick<HandlerDeps, 'config' | 'pool'>, row: RequestRow, root: string): Promise<Prepared | { failed: string }> {
  const accountProvider = accountPresetProvider(row.preset);
  const pipelineOpts = row.pipeline_mode && row.pipeline_mode !== 'full' ? { pipelineMode: row.pipeline_mode } : undefined;
  const write = (doc: Record<string, unknown>) => {
    const file = path.join(root, 'run.config.json');
    fs.writeFileSync(file, `${JSON.stringify(doc)}\n`, { mode: 0o600 });
    return file;
  };
  if (accountProvider) {
    const provider = providerById(accountProvider);
    const key = await readAccountKey(deps.pool, deps.config.accountKeysSecret, row.account, accountProvider);
    if (!provider?.keyEnv || !key || !row.models?.length) return { failed: `${accountProvider}_account_key_or_models_missing` };
    const configFile = write(accountConfigDocument(row.preset, row.models, pipelineOpts));
    return { configFile, providerEnv: { [provider.keyEnv]: key }, providerScope: [...provider.envAllowlist] };
  }
  // Every request is created on an account's own key; a row with any other preset predates that rule.
  return { failed: 'preset_not_supported' };
}

function seedFromParentReport(deps: HandlerDeps, parentId: string, destDir: string): boolean {
  const attempt = completedAttempt(deps.config.storage.runsRoot, parentId);
  const published = readPublished(deps.config.storage.reportsRoot, parentId);
  const src = attempt?.out && fs.existsSync(attempt.out) ? attempt.out : published?.dir && fs.existsSync(published.dir) ? published.dir : null;
  if (!src) return false;
  const copyUnlocked = (from: string, to: string) => {
    fs.mkdirSync(to, { recursive: true, mode: 0o700 });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.name === 'published.json' || entry.name === 'report.pdf') continue;
      const srcChild = path.join(from, entry.name);
      const dstChild = path.join(to, entry.name);
      if (entry.isDirectory()) copyUnlocked(srcChild, dstChild);
      else if (entry.isFile()) {
        fs.copyFileSync(srcChild, dstChild);
        fs.chmodSync(dstChild, 0o600);
      }
    }
  };
  copyUnlocked(src, destDir);
  return true;
}

async function runEngine(deps: HandlerDeps, row: RequestRow, attempt: number, signal: AbortSignal): Promise<{ outcome: Outcome; out: string }> {
  const dirs = attemptDirs(deps.config.storage.runsRoot, row.id, attempt);
  const abort = new AbortController();
  const onStop = () => abort.abort();
  signal.addEventListener('abort', onStop, { once: true });
  // A shutdown that landed before the listener existed must still stop this run.
  if (signal.aborted) onStop();
  const tailer = new ProgressTailer(deps, row.id, dirs.out);
  tailer.start(deps.config.progressPollMs);
  try {
    const prepared = await prepareProviders(deps, row, dirs.root);
    if ('failed' in prepared) return { outcome: { kind: 'infra_failed', cause: prepared.failed }, out: dirs.out };
    const { configFile, providerEnv, providerScope } = prepared;
    const isContinuationStep = Boolean(row.parent_id && row.debate_rounds !== null && row.debate_rounds !== undefined && row.debate_rounds >= 0);
    if (isContinuationStep && row.parent_id) {
      if (!seedFromParentReport(deps, row.parent_id, dirs.out)) {
        return { outcome: { kind: 'infra_failed', cause: 'parent_report_missing' }, out: dirs.out };
      }
      const contMarker = {
        action: row.debate_rounds === 0 ? 'advise' : 'debate',
        rounds: row.debate_rounds ?? 0,
      };
      fs.writeFileSync(path.join(dirs.out, '.omni-continue-pipeline.json'), `${JSON.stringify(contMarker)}\n`, { mode: 0o600 });
    }
    const result = await deps.engine.run({
      repo: row.repo, commitSha: row.commit_sha, preset: row.preset, outDir: dirs.out, logPath: dirs.log, configFile, providerEnv, providerScope,
      ...(row.pipeline_mode ? { pipelineMode: row.pipeline_mode } : {}),
      ...(isContinuationStep && row.debate_rounds !== null ? { debateRounds: row.debate_rounds } : {}),
      ...(row.slice_path ? { sourceDir: row.slice_path } : {}),
    }, abort.signal);
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
      return publish(deps, row, out, outcome.incomplete);
    case 'infra_failed':
      return fail(deps, row, outcome.cause);
    case 'engine_error':
      if (!lastAttempt) throw new RetryJobError(`engine error (${outcome.cause}); retrying`);
      return fail(deps, row, `engine_error_after_retry:${outcome.cause}`);
    case 'operator_error':
      if (!lastAttempt) throw new RetryJobError(`engine could not start (${outcome.cause}); retrying`);
      // Not the user's fault and not a review result: an operator has to look.
      await markFailed(deps, row.id, `operator:${outcome.cause}`);
      deps.log.error({ requestId: row.id, cause: outcome.cause }, 'ALERT engine cannot be started; request left failed for an operator');
      return { status: 'failed', reason: outcome.cause };
    case 'aborted':
      throw new RunInterruptedError('run interrupted by worker shutdown');
  }
}

/** Resume a request that an earlier delivery left part-way, or start it. */
export async function handleReview(deps: HandlerDeps, job: ReviewJob, ctx: JobContext): Promise<HandlerResult> {
  let row = await findRequest(deps.pool, job.requestId);
  if (!row) return { status: 'skipped', reason: 'job does not match a request' };
  if (row.status === 'done' || row.status === 'failed') return { status: 'skipped', reason: row.status };
  if (row.status === 'publishing') return publish(deps, row, null, Boolean(row.incomplete));
  // Attempts count engine runs started for this request, across deliveries and released jobs alike.
  const attempt = row.attempts;
  row = await transition(deps.pool, row.id, {
    to: 'running', patch: { attempts: attempt + 1 }, actor: 'worker', event: 'review_started', data: { attempt: attempt + 1 }, now: deps.clock.now(),
  });
  const earlier = completedAttempt(deps.config.storage.runsRoot, row.id);
  // A crash after publishing but before the status write: finish the published report.
  if (readPublished(deps.config.storage.reportsRoot, row.id)) return publish(deps, row, null, earlier?.incomplete ?? false);
  // A crash after the engine finished but before publishing: publish that run instead of re-running.
  if (earlier) return publish(deps, row, earlier.out, earlier.incomplete);
  if (ctx.signal.aborted) throw new RunInterruptedError('worker shutdown before the engine started');
  const { outcome, out } = await runEngine(deps, row, attempt, ctx.signal);
  return settle(deps, row, outcome, out, ctx);
}

/** A job that exhausted its retries (its worker died each time): an infra failure unless the report exists. */
export async function handleDeadReview(deps: HandlerDeps, job: ReviewJob): Promise<HandlerResult> {
  const row = await findRequest(deps.pool, job.requestId);
  if (!row) return { status: 'skipped', reason: 'job does not match a request' };
  if (row.status === 'done' || row.status === 'failed') return { status: 'skipped', reason: row.status };
  if (row.status === 'publishing' || (row.status === 'running' && readPublished(deps.config.storage.reportsRoot, row.id))) return publish(deps, row, null, false);
  return fail(deps, row, 'worker_lost');
}
