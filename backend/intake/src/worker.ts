// The worker runs a review by spawning ./bin/audit with an argv array.
// Tests use the mock engine. The argv is the same one a real spawn would use.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.ts';

export function auditArgv(job: { repo: string; ref: string; preset: string; out: string }) {
  for (const value of [job.repo, job.ref, job.preset, job.out]) {
    if (typeof value !== 'string' || value.includes('--') || /\s/.test(value)) throw new Error('audit argv field rejected');
  }
  return ['./bin/audit', 'run', '--github', job.repo, '--ref', job.ref, '--preset', job.preset, '--out', job.out];
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function reportSha256(findings: unknown, general: unknown) {
  return crypto.createHash('sha256').update(canonicalJson(findings) + canonicalJson(general ?? {})).digest('hex');
}

export function hashReportDir(dir: string) {
  const findings = JSON.parse(fs.readFileSync(path.join(dir, 'findings-and-scores.json'), 'utf8'));
  const generalPath = path.join(dir, 'general-review.json');
  const general = fs.existsSync(generalPath) ? JSON.parse(fs.readFileSync(generalPath, 'utf8')) : {};
  return reportSha256(findings, general);
}

export function writeMockReport(dir: string, mode: 'ok' | 'findings') {
  fs.mkdirSync(dir, { recursive: true });
  const findings = mode === 'findings'
    ? [{ title: 'Critical bug', severity: 'critical', status: 'CONFIRMED' }]
    : [{ title: 'Note', severity: 'low', status: 'LIKELY' }];
  const general = { executiveSummary: 'Reviewed.', riskPosture: mode === 'findings' ? 'critical-exposure' : 'low-observed' };
  fs.writeFileSync(path.join(dir, 'findings-and-scores.json'), `${JSON.stringify(findings, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'general-review.json'), `${JSON.stringify(general, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'report.html'), '<!DOCTYPE html><title>report</title>\n');
}

export async function runJob(pool: store.Pool, id: string, opts: { mode?: 'ok' | 'findings' | 'infra'; crashAfter?: 'attested'; reportsRoot: string }) {
  const row = await store.getRequest(pool, id);
  if (!row) throw new Error('missing request');
  const out = path.join(opts.reportsRoot, id);
  const argv = auditArgv({ repo: row.repo, ref: row.commit_sha, preset: row.preset, out });
  if (argv.includes('--rpc')) throw new Error('rpc is not an audit flag');
  fs.mkdirSync(opts.reportsRoot, { recursive: true });
  fs.writeFileSync(path.join(opts.reportsRoot, `${id}.argv.json`), `${JSON.stringify(argv)}\n`);
  const mode = opts.mode || 'ok';
  if (mode === 'infra') {
    const refund = await store.refundOnce(pool, row.request_hash);
    await store.setStatus(pool, id, 'refunded', new Date());
    return { status: 'refunded' as const, argv, refund };
  }
  writeMockReport(out, mode);
  const hash = hashReportDir(out);
  const attest = await store.attestOnce(pool, row.request_hash, hash);
  if (opts.crashAfter === 'attested') return { status: 'running' as const, argv, hash, attest };
  await store.setStatus(pool, id, 'done', new Date());
  return { status: 'done' as const, argv, hash, attest };
}

export async function resume(pool: store.Pool, id: string) {
  const row = await store.getRequest(pool, id);
  if (!row) throw new Error('missing request');
  const count = await store.attestationCount(pool, row.request_hash);
  if (count === 1 && row.status !== 'done') await store.setStatus(pool, id, 'done', new Date());
  return store.attestationCount(pool, row.request_hash);
}

export async function drainOne(pool: store.Pool, opts: { mode?: 'ok' | 'findings' | 'infra'; crashAfter?: 'attested'; reportsRoot: string }) {
  const id = await store.claimNext(pool, new Date());
  if (!id) return null;
  return { id, ...(await runJob(pool, id, opts)) };
}
