// Review-worker supervisor entry points: the inert fixture and terminal runs (both through worker-run.mjs
// runIsolated) and the blocked-run record that orchestrate.sh writes when no worker backend is integrated.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isReviewerId } from './reviewer-registry.mjs';
import { REVIEW_IMAGE, backendStatus, createSnapshot, disposeSnapshot, createJob } from './worker-isolation.mjs';
import { writeReportFile } from './report-files.mjs';
import { validateReviewRequest } from './terminal-review-contract.mjs';
import { runIsolated, runtimeDigest, transition } from './worker-run.mjs';

export { createRecordDirectory, disposeRecordDirectory, runtimeDigest, transition } from './worker-run.mjs';

export function runFixture(snapshot, job, options = {}) {
  if (job.phase === 'terminal') throw new Error('terminal jobs require the explicit terminal entry point');
  return runIsolated(snapshot, job, options);
}
export function runTerminalReview(snapshot, job, request, onReview, options = {}) {
  validateReviewRequest(request);
  if (job.phase !== 'terminal' || request.jobId !== job.id || request.sourceDigest !== job.sourceDigest || typeof onReview !== 'function') throw new Error('terminal job authorization rejected');
  return runIsolated(snapshot, job, { ...options, terminalRequest: structuredClone(request), onReview });
}
export function recordBlockedRun(request) {
  if (!request || !Array.isArray(request.agents) || !request.agents.length || !request.agents.every(isReviewerId) || new Set(request.agents).size !== request.agents.length) throw new Error('invalid requested adapters');
  const output = path.resolve(request.out);
  if (output === fs.realpathSync(request.target)) throw new Error('output cannot be the source root');
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('output directory must be empty');
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.chmodSync(output, 0o700);
  fs.mkdirSync(path.join(output, 'auditors'), { mode: 0o700 });
  let snapshot;
  try {
    snapshot = createSnapshot(request.target, { exclude: [output] });
    const runtime = runtimeDigest();
    const slugs = ['auth', 'input', 'logic', 'config', 'deps', 'client'];
    const surface = request.surface === 'all' ? 'all' : /^s[1-6]$/.test(request.surface) ? request.surface : `s${slugs.indexOf(request.surface) + 1}`;
    const ids = surface === 'all' ? [1, 2, 3, 4, 5, 6] : [Number(surface.slice(1))];
    const jobs = ids.flatMap((id, i) => (surface === 'all' ? [request.agents[i % request.agents.length]] : request.agents).map((adapter) => createJob({ adapter, model: request.models[adapter], surface: `s${id}`, sourceDigest: snapshot.manifest.digest, runtimeDigest: runtime })));
    const manifest = { version: 1, runId: crypto.randomUUID(), policy: 'read_only_source_review', sourceDigest: snapshot.manifest.digest, runtimeDigest: runtime, image: REVIEW_IMAGE, jobs };
    writeReportFile(output, 'workers.json', `${JSON.stringify(manifest, null, 2)}\n`);
    for (const job of jobs) transition(job, 'blocked', { reason: backendStatus(job.adapter).reason, observedExitCode: null });
    writeReportFile(output, 'workers.json', `${JSON.stringify(manifest, null, 2)}\n`);
    writeReportFile(output, 'source-manifest.json', `${JSON.stringify(snapshot.manifest, null, 2)}\n`);
    const meta = { name: request.name || path.basename(request.target), mode: request.mode, source: request.source, ref: request.ref || null, commit: request.commit || null, date: new Date().toISOString(), surface, agents: request.agents, models: request.models, auditors: jobs.map((j) => j.name), workerExits: Object.fromEntries(jobs.map((j) => [j.name, null])), crosscheckExits: {}, stageFailures: ['subscription_bridge_unverified'], finalized: true, isolation: { policy: manifest.policy, sourceDigest: manifest.sourceDigest, liveTransport: 'blocked', privateOutputs: 'required', workerManifest: 'workers.json' } };
    writeReportFile(output, 'meta.json', `${JSON.stringify(meta, null, 2)}\n`);
    return manifest;
  } finally { if (snapshot) disposeSnapshot(snapshot); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, file] = process.argv.slice(2);
    if (mode !== 'blocked-run') throw new Error('supervisor command refused');
    const request = JSON.parse(fs.readFileSync(file, 'utf8'));
    recordBlockedRun(request);
    console.error('BLOCKED: legacy multi-surface adapters are not integrated with the selected-file terminal connector. A ready Claude login does not enable audit run. No host fallback or target execution.');
    process.exitCode = 2;
  } catch (err) {
    console.error(`review isolation: ${err.message}`);
    process.exitCode = 2;
  }
}
