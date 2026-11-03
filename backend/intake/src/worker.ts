// The worker starts a review by spawning ./bin/audit. The argv is an array and
// never includes --rpc. A mock engine is a bin/audit the test places on ENGINE_ROOT.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, reportDocument } from '@omniswarm/schemas/canonical-json';
import * as store from './store.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../..');

export function auditArgv(job: { repo: string; ref: string; preset: string; out: string }) {
  for (const value of [job.repo, job.ref, job.preset, job.out]) {
    if (typeof value !== 'string' || value.includes('--') || /\s/.test(value)) throw new Error('audit argv field rejected');
  }
  const argv = ['./bin/audit', 'run', '--github', job.repo, '--ref', job.ref, '--preset', job.preset, '--out', job.out];
  if (argv.includes('--rpc')) throw new Error('rpc is not an audit flag');
  return argv;
}

// The report hash is sha256 over reportDocument (@omniswarm/schemas/canonical-json),
// the same bytes the review page recomputes with Web Crypto.
export { canonicalJson };

export function reportSha256(findings: unknown, general: unknown) {
  return crypto.createHash('sha256').update(reportDocument(findings, general)).digest('hex');
}

export function hashReportDir(dir: string) {
  const findings = JSON.parse(fs.readFileSync(path.join(dir, 'findings-and-scores.json'), 'utf8'));
  const generalPath = path.join(dir, 'general-review.json');
  const general = fs.existsSync(generalPath) ? JSON.parse(fs.readFileSync(generalPath, 'utf8')) : {};
  return reportSha256(findings, general);
}

export function spawnAudit(engineRoot: string, argv: string[], env: NodeJS.ProcessEnv = {}) {
  if (argv[0] !== './bin/audit' || argv[1] !== 'run' || argv.includes('--rpc')) {
    throw new Error('refusing audit argv');
  }
  return new Promise<void>((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: engineRoot,
      shell: false,
      env: { ...process.env, ...env },
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `audit exited ${code}`));
    });
  });
}

export async function runJob(pool: store.Pool, id: string, opts: {
  mode?: 'ok' | 'findings' | 'infra';
  crashAfter?: 'before-attest' | 'attested';
  reportsRoot: string;
  engineRoot?: string;
}) {
  const row = await store.getRequest(pool, id);
  if (!row) throw new Error('missing request');
  const out = path.join(opts.reportsRoot, id);
  const argv = auditArgv({ repo: row.repo, ref: row.commit_sha, preset: row.preset, out });
  const engineRoot = opts.engineRoot || REPO_ROOT;
  const mode = opts.mode || 'ok';
  try {
    await spawnAudit(engineRoot, argv, { MOCK_ENGINE_FAIL: mode === 'ok' ? '' : mode });
  } catch (error) {
    const refund = await store.refundOnce(pool, row.request_hash);
    await store.setStatus(pool, id, 'refunded', new Date());
    return { status: 'refunded' as const, argv, refund, error: error instanceof Error ? error.message : String(error) };
  }
  if (opts.crashAfter === 'before-attest') return { status: 'running' as const, argv, hash: '' };
  const hash = hashReportDir(out);
  const attest = await store.attestOnce(pool, row.request_hash, hash);
  if (opts.crashAfter === 'attested') return { status: 'running' as const, argv, hash, attest };
  await store.setStatus(pool, id, 'done', new Date());
  return { status: 'done' as const, argv, hash, attest };
}

export async function resume(pool: store.Pool, id: string, opts: { reportsRoot: string; engineRoot?: string; mode?: 'ok' | 'findings' | 'infra' }) {
  const row = await store.getRequest(pool, id);
  if (!row) throw new Error('missing request');
  if (row.status === 'refunded') return store.attestationCount(pool, row.request_hash);
  const count = await store.attestationCount(pool, row.request_hash);
  if (count >= 1) {
    if (row.status !== 'done') await store.setStatus(pool, id, 'done', new Date());
    return store.attestationCount(pool, row.request_hash);
  }
  if (row.status === 'running' || row.status === 'queued') {
    await runJob(pool, id, opts);
  }
  return store.attestationCount(pool, row.request_hash);
}

export async function recoverInFlight(pool: store.Pool, opts: { reportsRoot: string; engineRoot?: string; mode?: 'ok' | 'findings' | 'infra' }) {
  const ids = await store.runningIds(pool);
  const recovered = [];
  for (const id of ids) {
    await resume(pool, id, opts);
    const row = await store.getRequest(pool, id);
    recovered.push({ id, status: row.status as string });
  }
  return recovered;
}

export async function drainOne(pool: store.Pool, opts: {
  mode?: 'ok' | 'findings' | 'infra';
  crashAfter?: 'before-attest' | 'attested';
  reportsRoot: string;
  engineRoot?: string;
}) {
  const id = await store.claimNext(pool, new Date());
  if (!id) return null;
  return { id, ...(await runJob(pool, id, opts)) };
}
