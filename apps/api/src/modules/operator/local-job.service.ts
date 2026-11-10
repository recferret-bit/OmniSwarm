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
import type { Logger } from '../../shared/logger.ts';
import { checkRepo } from '../quote/quote.service.ts';
import { parseGitHubInput } from '../quote/repo-url.ts';
import { progressFromSnapshot } from '../../worker/progress-detail.ts';
import { assertNormalizedAbsolute, launchLocalJob, localAuditArgv, localAuditCommand, type LocalLaunch } from './local-audit.ts';

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
  return {
    id: row.id, kind: row.kind, source: row.source, ref: row.ref, commitSha: row.commit_sha, status: row.status,
    error: row.error, createdAt: iso(row.created_at), pdfReady: row.status === 'done' && pdfReady(pdfPath(config, row.id)),
    ...(progress ? { progress } : {}),
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

export async function createLocalJob(deps: LocalDeps, body: { path: string } | { github: string }) {
  const id = crypto.randomUUID();
  const now = deps.clock.now();
  const outDir = outDirFor(deps.config, id);
  let kind: 'path' | 'github';
  let source: string;
  let ref: string | null = null;
  let commitSha: string | null = null;
  let args: string[];
  if ('path' in body) {
    source = resolveLocalDirectory(body.path);
    kind = 'path';
    args = localAuditArgv({ kind: 'path', target: source, outDir });
  } else {
    const parsed = parseGitHubInput(body.github);
    const checked = await checkRepo({ config: deps.config, db: deps.pool, github: deps.github }, parsed.repo, parsed.ref);
    kind = 'github';
    source = checked.repo;
    ref = parsed.ref;
    commitSha = checked.commitSha;
    args = localAuditArgv({ kind: 'github', repo: checked.repo, ref: checked.commitSha, outDir });
  }
  fs.mkdirSync(outDir, { recursive: true });
  await insertOperatorJob(deps.pool, { id, kind, source, ref, commitSha, outDir, now });
  const launch: LocalLaunch = {
    id, kind, argv: localAuditCommand(deps.config.engine.root, args), outDir, cwd: deps.config.engine.root, engineRoot: deps.config.engine.root,
    mark: (status, error) => mark(deps, id, status, error),
  };
  launchLocalJob(launch);
  return localJobCreated({ id, kind, source });
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
