// Loopback operator jobs. The process is spawned in the background; the HTTP response stays `queued`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../../config/load.ts';
import type { Pool } from '../../db/pool.ts';
import {
  findOperatorJob, insertOperatorJob, listOperatorJobs, updateOperatorJob, type OperatorJobRow, type OperatorStatus,
} from '../../db/repositories/operator-jobs.ts';
import type { GitHubPort } from '../../github/port.ts';
import { iso, type Clock } from '../../shared/clock.ts';
import { fail } from '../../shared/errors.ts';
import type { z } from 'zod';
import type { progress as progressSchema } from '../../http/schemas.ts';
import type { Logger } from '../../shared/logger.ts';
import { checkRepo } from '../../github/repo-check.ts';
import { parseGitHubInput } from '../../github/repo-url.ts';
import { progressFromSnapshot } from '../../worker/progress-detail.ts';
import { readPipelineSummary, type PipelineMode } from '../requests/pipeline-view.ts';
import {
  assertNormalizedAbsolute, launchLocalJob, localAdviseArgv, localAuditArgv, localAuditCommand, localDebateArgv, type LocalLaunch,
} from './local-audit.ts';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function assertLocalOperator(config: { localMode: boolean }, ip: string | undefined): void {
  const address = (ip ?? '').split('%')[0] ?? '';
  if (!config.localMode || !LOOPBACK.has(address)) fail('FORBIDDEN', 'Local operator routes are loopback only');
}

/** User path: absolute, no `..`, real directory. `..` is rejected even when it would normalize away. */
export function resolveLocalDirectory(input: string): string {
  assertNormalizedAbsolute(input);
  let real: string;
  try {
    real = fs.realpathSync(path.resolve(input));
  } catch {
    fail('VALIDATION_ERROR', 'Path is not an absolute directory');
  }
  assertNormalizedAbsolute(real);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    fail('VALIDATION_ERROR', 'Path is not an absolute directory');
  }
  if (!stat.isDirectory()) fail('VALIDATION_ERROR', 'Path is not an absolute directory');
  return real;
}

function outDirFor(config: Config, id: string): string {
  return assertNormalizedAbsolute(path.join(config.storage.runsRoot, 'local', id));
}

export interface LocalDeps { config: Config; pool: Pool; clock: Clock; github: GitHubPort; log: Logger }

function pdfPath(config: Config, id: string): string {
  return path.join(outDirFor(config, id), 'report.pdf');
}

function pdfReady(file: string): boolean {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function localJobCreated(row: { id: string; kind: OperatorJobRow['kind']; source: string }) {
  return { id: row.id, kind: row.kind, source: row.source, status: 'queued' as const };
}

export function localJobListItem(row: OperatorJobRow) {
  return { id: row.id, kind: row.kind, source: row.source, status: row.status, createdAt: iso(row.created_at) };
}

export function localJobView(config: Config, row: OperatorJobRow) {
  // The engine's live snapshot from the job's own out dir: the same progress object a hosted request carries.
  const progress = row.status !== 'queued' && row.out_dir ? progressFromSnapshot(row.out_dir) : null;
  const pipeline = row.out_dir ? readPipelineSummary(row.out_dir, row.pipeline_mode) : null;
  const showMode = (row.pipeline_mode && row.pipeline_mode !== 'full') || Boolean(pipeline);
  return {
    id: row.id, kind: row.kind, source: row.source, ref: row.ref, commitSha: row.commit_sha, status: row.status,
    error: row.error, createdAt: iso(row.created_at), pdfReady: row.status === 'done' && pdfReady(pdfPath(config, row.id)),
    // progressFromSnapshot copies only the schema's fields, as the worker does for a hosted request.
    ...(progress ? { progress: progress as z.infer<typeof progressSchema> } : {}),
    ...(showMode ? { pipelineMode: row.pipeline_mode ?? 'full' } : {}),
    ...(pipeline ? { pipeline } : {}),
  };
}

async function mark(deps: LocalDeps, id: string, status: OperatorStatus, error?: string | null): Promise<void> {
  try {
    const text = error ? error.slice(0, 200) : null;
    await updateOperatorJob(deps.pool, id, { status, error: status === 'failed' ? (text ?? 'audit failed') : null, now: deps.clock.now() });
  } catch (err) {
    deps.log.warn({ err, id }, 'local job update failed');
  }
}

export async function createLocalJob(
  deps: LocalDeps,
  body: ({ path: string } | { github: string }) & { pipelineMode?: PipelineMode; concurrency?: number },
) {
  const id = crypto.randomUUID();
  const now = deps.clock.now();
  const outDir = outDirFor(deps.config, id);
  const pipelineMode: PipelineMode = body.pipelineMode ?? 'full';
  let kind: 'path' | 'github';
  let source: string;
  let ref: string | null = null;
  let commitSha: string | null = null;
  let args: string[];
  if ('path' in body) {
    source = resolveLocalDirectory(body.path);
    kind = 'path';
    args = localAuditArgv({ kind: 'path', target: source, outDir, pipelineMode, concurrency: body.concurrency });
  } else {
    const parsed = parseGitHubInput(body.github);
    const checked = await checkRepo({ config: deps.config, github: deps.github }, parsed.repo, parsed.ref);
    kind = 'github';
    source = checked.repo;
    ref = parsed.ref;
    commitSha = checked.commitSha;
    args = localAuditArgv({ kind: 'github', repo: checked.repo, ref: checked.commitSha, outDir, pipelineMode, concurrency: body.concurrency });
  }
  fs.mkdirSync(outDir, { recursive: true });
  await insertOperatorJob(deps.pool, { id, kind, source, ref, commitSha, outDir, pipelineMode, now });
  const launch: LocalLaunch = {
    id, kind, argv: localAuditCommand(deps.config.engine.root, args), outDir, cwd: deps.config.engine.root, engineRoot: deps.config.engine.root,
    mark: (status, error) => mark(deps, id, status, error),
  };
  launchLocalJob(launch);
  return localJobCreated({ id, kind, source });
}

export async function adviseLocalJob(deps: LocalDeps, id: string) {
  const row = await findOperatorJob(deps.pool, id);
  if (!row || !row.out_dir) fail('NOT_FOUND', 'Job not found');
  if (row.status !== 'done') {
    fail('INVALID_TRANSITION', `Job is ${row.status}; Step 2 advice can only run on a finished job`);
  }
  const args = localAdviseArgv({ outDir: row.out_dir, target: row.kind === 'path' ? row.source : null });
  await updateOperatorJob(deps.pool, id, { status: 'queued', error: null, now: deps.clock.now() });
  try { fs.rmSync(pdfPath(deps.config, id), { force: true }); } catch { /* ignore */ }
  const launch: LocalLaunch = {
    id, kind: row.kind, argv: localAuditCommand(deps.config.engine.root, args), outDir: row.out_dir,
    cwd: deps.config.engine.root, engineRoot: deps.config.engine.root,
    mark: (status, error) => mark(deps, id, status, error),
  };
  launchLocalJob(launch);
  return localJobCreated({ id, kind: row.kind, source: row.source });
}

export async function continueLocalJobDebate(deps: LocalDeps, id: string, rounds = 1) {
  const row = await findOperatorJob(deps.pool, id);
  if (!row || !row.out_dir) fail('NOT_FOUND', 'Job not found');
  if (row.status !== 'done') {
    fail('INVALID_TRANSITION', `Job is ${row.status}; debate rounds can only continue a finished job`);
  }
  const args = localDebateArgv({ outDir: row.out_dir, rounds, target: row.kind === 'path' ? row.source : null });
  await updateOperatorJob(deps.pool, id, { status: 'queued', error: null, now: deps.clock.now() });
  // Remove previous PDF stub so ensureReportPdf regenerates after the new debate round completes
  try { fs.rmSync(pdfPath(deps.config, id), { force: true }); } catch { /* ignore */ }
  const launch: LocalLaunch = {
    id, kind: row.kind, argv: localAuditCommand(deps.config.engine.root, args), outDir: row.out_dir,
    cwd: deps.config.engine.root, engineRoot: deps.config.engine.root,
    mark: (status, error) => mark(deps, id, status, error),
  };
  launchLocalJob(launch);
  return localJobCreated({ id, kind: row.kind, source: row.source });
}

export async function listLocalJobs(deps: LocalDeps) {
  const rows = await listOperatorJobs(deps.pool);
  return { jobs: rows.map(localJobListItem) };
}

export async function viewLocalJob(deps: LocalDeps, id: string) {
  const row = await findOperatorJob(deps.pool, id);
  if (!row) fail('NOT_FOUND', 'Job not found');
  return localJobView(deps.config, row);
}

export function readLocalReportPdf(config: Config, row: OperatorJobRow): Buffer {
  if (row.status !== 'done') fail('NOT_FOUND', 'Report not found');
  const file = pdfPath(config, row.id);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    fail('NOT_FOUND', 'Report not found');
  }
  if (!stat.isFile() || stat.size === 0) fail('NOT_FOUND', 'Report not found');
  return fs.readFileSync(file);
}

export async function localReportPdf(deps: LocalDeps, id: string): Promise<Buffer> {
  const row = await findOperatorJob(deps.pool, id);
  if (!row) fail('NOT_FOUND', 'Report not found');
  return readLocalReportPdf(deps.config, row);
}
