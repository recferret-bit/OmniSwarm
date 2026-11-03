// One isolated review-worker run (the supervisor's engine): the private record directory, the job state machine,
// and runIsolated: seal the trusted runtime, start a network-less worker plus a collector, relay at most one
// terminal review, collect the outbox and clean up every owned resource. Entry points are in worker-supervisor.mjs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { REVIEW_IMAGE, LIMITS, hash, createSnapshot, disposeSnapshot, requireOwnedSnapshot, validateOutput, expectedFiles } from './worker-isolation.mjs';
import { writeReportFile } from './report-files.mjs';
import { validateReviewRequest, validateResult, encodeFrame, readJsonLine } from './terminal-review-contract.mjs';
import { REPO_ROOT, CONTAINER_ENTRY, runtimeBundle, bundleDigest, liveBundleDigest } from './worker-isolation-bundle.mjs';
import { IMAGE, abortable, attachTerminal, docker, removeOwned, requireDocker, security } from './worker-docker.mjs';

const OWNED_RECORDS = new Map();
export function createRecordDirectory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-review-ledger-'));
  fs.chmodSync(dir, 0o700);
  const stat = fs.lstatSync(dir);
  OWNED_RECORDS.set(dir, { dev: stat.dev, ino: stat.ino });
  return dir;
}
export function disposeRecordDirectory(dir) {
  const identity = OWNED_RECORDS.get(dir);
  const stat = identity && fs.lstatSync(dir);
  if (!identity || !stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino) throw new Error('refusing cleanup of an unowned or replaced ledger directory');
  fs.rmSync(dir, { recursive: true, force: true });
  OWNED_RECORDS.delete(dir);
}
const STATES = {
  pending: ['running', 'blocked', 'failed', 'cancelled'],
  running: ['failed', 'timed_out', 'cancelled', 'rejected_output', 'collected'],
};
export function transition(job, state, detail = {}) {
  if (!STATES[job.state]?.includes(state)) throw new Error('invalid worker state transition');
  Object.assign(job, detail, { state });
}
export function runtimeDigest() {
  return liveBundleDigest();
}

const FIXTURES = ['probe', 'wait', 'malformed', 'extra', 'oversized'];
const ALLOWED_ENV = new Set(['HOME', 'PATH', 'NODE_VERSION', 'YARN_VERSION']);

function checkRun(snapshot, job, { fixture, image, deadlineMs }) {
  if (!FIXTURES.includes(fixture) || (deadlineMs != null && (!Number.isSafeInteger(deadlineMs) || deadlineMs < 50 || deadlineMs > 2_147_483_647))) throw new Error('invalid fixture limits');
  requireOwnedSnapshot(snapshot);
  if (!IMAGE.test(image) || job.state !== 'pending' || job.sourceDigest !== snapshot.manifest.digest || job.runtimeDigest !== runtimeDigest() || JSON.stringify(job.expected) !== JSON.stringify(expectedFiles(job.phase)) || job.assignmentDigest !== hash(JSON.stringify(job.claims))) throw new Error('invalid immutable job runtime');
}

// The private work directory (read-only job input, collected outputs) and the fresh parent-owned ledger directory.
function prepareDirectories(job, { fixture, deadlineMs, recordDir, terminalRequest }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-job-'));
  fs.chmodSync(work, 0o700);
  const input = path.join(work, 'input');
  const collected = path.join(work, 'collected');
  const records = recordDir || createRecordDirectory();
  try {
    const recordStat = fs.lstatSync(records);
    if (!recordStat.isDirectory() || recordStat.isSymbolicLink() || (recordStat.mode & 0o077) !== 0 || recordStat.uid !== process.getuid() || fs.readdirSync(records).length) {
      fs.rmSync(work, { recursive: true, force: true });
      throw new Error('ledger requires a fresh private parent-owned directory');
    }
    fs.mkdirSync(input, { mode: 0o755 });
    fs.mkdirSync(collected, { mode: 0o700 });
    fs.writeFileSync(path.join(input, 'job.json'), JSON.stringify(terminalRequest
      ? { job, executionMode: 'terminal_supplied_unverified', terminalRequest, terminalDeadlineMs: deadlineMs }
      : { job, executionMode: 'inert_fixture', fixture }), { mode: 0o444 });
    fs.chmodSync(input, 0o555);
  } catch (err) {
    fs.rmSync(work, { recursive: true, force: true });
    throw err;
  }
  return { work, input, collected, records };
}

function newLedger(run, deadlineMs) {
  const { image, job, records, worker, volume, collector, label, terminalRequest } = run;
  const ledger = { version: 1, executionMode: terminalRequest ? 'terminal_supplied_unverified' : 'inert_fixture', image, job, recordDirectory: records, resources: { worker, volume, collector, label }, credentialPolicy: 'none_in_worker', toolPolicy: 'no_shell_or_target_execution', limits: { executionDeadlineMs: deadlineMs, controlDeadlineMs: 15_000, outputBytes: LIMITS.outputBytes, logBytes: LIMITS.logBytes, outboxBytes: 16 * 1024 * 1024, memoryBytes: 128 * 1024 * 1024, cpus: 1, pids: 64 } };
  ledger.policyDigest = hash(JSON.stringify({ credentials: ledger.credentialPolicy, tools: ledger.toolPolicy, limits: ledger.limits }));
  return ledger;
}

// True (and the job cancelled) when the run was cancelled.
function stopped(run) {
  if (!run.cancelled.aborted) return false;
  transition(run.job, 'cancelled');
  return true;
}

// Seal the trusted runtime, check the image, create the outbox volume, the collector and the worker, verify
// the worker's boundary and start it. Returns false when the run was cancelled on the way.
async function startWorker(run) {
  const { image, label, volume, worker, collector, input, snapshot, terminalRequest, ledger, job } = run;
  const bundle = runtimeBundle();
  run.runtime = createSnapshot(REPO_ROOT, { only: bundle });
  requireOwnedSnapshot(run.runtime);
  const capturedDigest = bundleDigest(bundle, (rel) => run.runtime.manifest.files.find((f) => f.path === rel)?.sha256);
  if (capturedDigest !== job.runtimeDigest) throw new Error('trusted runtime changed before sealed capture');
  await requireDocker(['image', 'inspect', image, '--format', '{{.Id}}']);
  if (stopped(run)) return false;
  const imageKeys = (await requireDocker(['image', 'inspect', image, '--format', '{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}'])).stdout.trim().split(/\s+/).filter(Boolean);
  if (imageKeys.some((k) => !ALLOWED_ENV.has(k))) throw new Error('runtime image environment rejected');
  if (stopped(run)) return false;
  await requireDocker(['volume', 'create', '--driver', 'local', '--opt', 'type=tmpfs', '--opt', 'device=tmpfs', '--opt', 'o=size=16m,uid=10001,gid=10001,mode=0700,noexec,nosuid,nodev', '--label', `omniswarm.review.job=${label}`, volume]);
  const out = ['--mount', `type=volume,src=${volume},dst=/out`];
  const inputMount = ['--mount', `type=bind,src=${input},dst=/input,readonly`];
  await requireDocker(['run', '--detach', ...security(image, collector, label, run.runtime), '--mount', `type=volume,src=${volume},dst=/out,readonly`, ...inputMount, image, CONTAINER_ENTRY, 'hold']);
  if (stopped(run)) return false;
  await requireDocker(['create', ...(terminalRequest ? ['--interactive'] : []), ...security(image, worker, label, run.runtime), ...out, ...inputMount, '--mount', `type=bind,src=${snapshot.snapshot},dst=/source,readonly`, image, CONTAINER_ENTRY, terminalRequest ? 'terminal-review' : 'fixture']);
  const spec = JSON.parse((await requireDocker(['inspect', worker, '--format', '{{json .}}'])).stdout);
  ledger.boundary = { network: spec.HostConfig.NetworkMode, ipc: spec.HostConfig.IpcMode, pid: spec.HostConfig.PidMode, user: spec.Config.User, readOnly: spec.HostConfig.ReadonlyRootfs, capDrop: spec.HostConfig.CapDrop, securityOpt: spec.HostConfig.SecurityOpt, mounts: spec.Mounts.map((m) => ({ destination: m.Destination, readOnly: !m.RW, type: m.Type })), environmentKeys: spec.Config.Env.map((e) => e.split('=')[0]) };
  if (ledger.boundary.network !== 'none' || ledger.boundary.user !== '10001:10001' || !ledger.boundary.readOnly || !ledger.boundary.capDrop.includes('ALL') || !ledger.boundary.securityOpt.some((s) => s.startsWith('no-new-privileges')) || ledger.boundary.environmentKeys.some((k) => !ALLOWED_ENV.has(k))) throw new Error('runtime security specification rejected');
  if (terminalRequest) run.terminal = attachTerminal(worker);
  else await requireDocker(['start', worker]);
  return true;
}

// The one authorized review exchange: the worker's request must equal the supervisor's, the answer is validated.
async function relayTerminal(run, { deadlineMs, signal, onReview }) {
  const { terminal, terminalRequest, ledger } = run;
  const frame = await readJsonLine(terminal.child.stdout, { timeoutMs: deadlineMs, signal });
  validateReviewRequest(frame);
  if (JSON.stringify(frame) !== JSON.stringify(terminalRequest)) throw new Error('worker requested an unauthorized review');
  ledger.relay = { requestId: frame.requestId, requestDigest: hash(JSON.stringify(frame)), origin: 'terminal_supplied_unverified', modelIdentity: 'unverified', toolsDisabled: 'unverified' };
  run.save();
  const result = await abortable(onReview(frame), signal);
  validateResult(result, terminalRequest);
  terminal.child.stdin.end(encodeFrame({ version: 1, type: 'review.result', requestId: frame.requestId, jobId: frame.jobId, sourceDigest: frame.sourceDigest, result }));
  if (await abortable(terminal.closed, signal) !== 0) throw new Error('terminal worker exited unsuccessfully');
  ledger.relay.resultDigest = hash(JSON.stringify(result));
}

// Poll until the worker stops, the deadline passes or the run is cancelled; then record its exit code and logs.
async function awaitExit(run, deadline) {
  const { job, worker, ledger } = run;
  for (;;) {
    if (stopped(run)) break;
    if (Date.now() >= deadline) { transition(job, 'timed_out'); break; }
    const state = JSON.parse((await requireDocker(['inspect', worker, '--format', '{{json .State}}'])).stdout);
    if (!state.Running) {
      job.observedExitCode = state.ExitCode;
      if (state.ExitCode !== 0 || state.OOMKilled) transition(job, 'failed');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (job.state === 'cancelled' || job.state === 'timed_out') await requireDocker(['kill', worker]);
  const waited = await requireDocker(['wait', worker]);
  if (/^\d+\s*$/.test(waited.stdout)) job.observedExitCode = Number(waited.stdout.trim());
  const logs = await docker(['logs', worker]);
  ledger.logs = { stdout: logs.stdout, stderr: logs.stderr };
}

// A separate trusted process sees one stopped outbox, not the source tree.
async function collectOutputs(run) {
  const { job, collector, collected } = run;
  const exported = await requireDocker(['exec', '--user', '10001:10001', collector, '/usr/local/bin/node', CONTAINER_ENTRY, 'collect'], { maxBytes: LIMITS.outputBytes * 3 });
  const envelope = JSON.parse(exported.stdout);
  if (envelope.version !== 1 || !envelope.files || JSON.stringify(Object.keys(envelope.files).sort()) !== JSON.stringify([...job.expected].sort())) throw new Error('collector envelope rejected');
  for (const name of job.expected) {
    const base64 = envelope.files[name];
    if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length > Math.ceil(LIMITS.outputBytes / 3) * 4) throw new Error('collector bytes rejected');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > LIMITS.outputBytes || bytes.toString('base64') !== base64) throw new Error('collector encoding rejected');
    fs.writeFileSync(path.join(collected, name), bytes, { flag: 'wx', mode: 0o600 });
  }
  return validateOutput(job, collected);
}

function failedState(err, run, stage) {
  if (err.code === 'terminal_timeout') return 'timed_out';
  if (run.cancelled.aborted || err.code === 'terminal_cancelled') return 'cancelled';
  return stage === 'collection' ? 'rejected_output' : 'failed';
}

async function releaseDocker(run, cleanupErrors) {
  const { worker, collector, volume, label, terminal } = run;
  for (const name of [worker, collector]) {
    try { await removeOwned('container', name, label); } catch { cleanupErrors.push(name); }
  }
  try { await removeOwned('volume', volume, label); } catch { cleanupErrors.push(volume); }
  if (terminal && terminal.child.exitCode === null) terminal.child.kill('SIGKILL');
}

function releaseFiles(run, cleanupErrors) {
  try {
    fs.chmodSync(run.input, 0o700);
    fs.rmSync(run.work, { recursive: true, force: true });
  } catch { cleanupErrors.push(run.work); }
  if (run.runtime) {
    try { disposeSnapshot(run.runtime); } catch { cleanupErrors.push(run.runtime.staging); }
  }
}

export async function runIsolated(snapshot, job, { fixture = 'probe', image = REVIEW_IMAGE, deadlineMs = null, signal, onStarted, recordDir, terminalRequest, onReview } = {}) {
  checkRun(snapshot, job, { fixture, image, deadlineMs });
  const label = crypto.randomUUID();
  const prefix = `omni-review-${label}`;
  const run = { job, image, snapshot, terminalRequest, label, volume: `${prefix}-out`, worker: `${prefix}-worker`, collector: `${prefix}-collect` };
  Object.assign(run, prepareDirectories(job, { fixture, deadlineMs, recordDir, terminalRequest }));
  const ledger = newLedger(run, deadlineMs);
  run.ledger = ledger;
  run.save = () => writeReportFile(run.records, 'ledger.json', JSON.stringify(ledger, null, 2));
  const outcome = { ledger };
  let stage = 'setup';
  const interrupted = new AbortController();
  run.cancelled = signal ? AbortSignal.any([signal, interrupted.signal]) : interrupted.signal;
  const onSignal = () => { interrupted.abort(); process.exitCode = 130; };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    run.save();
    if (stopped(run) || !(await startWorker(run))) return outcome;
    transition(job, 'running', { startedAt: new Date().toISOString() });
    stage = 'execution';
    run.save();
    const deadline = deadlineMs == null ? Infinity : Date.now() + deadlineMs;
    const executionSignal = deadlineMs == null ? run.cancelled : AbortSignal.any([run.cancelled, AbortSignal.timeout(deadlineMs)]);
    if (onStarted) await abortable(onStarted(ledger), executionSignal);
    if (terminalRequest) await relayTerminal(run, { deadlineMs, signal: executionSignal, onReview });
    await awaitExit(run, deadline);
    if (job.state !== 'running' || stopped(run)) return outcome;
    stage = 'collection';
    const artifacts = await collectOutputs(run);
    if (stopped(run)) return outcome;
    transition(job, 'collected', { outputHashes: artifacts.hashes });
    outcome.artifacts = artifacts;
    return outcome;
  } catch (err) {
    if (job.state === 'running') transition(job, failedState(err, run, stage), { reason: stage === 'collection' ? 'output_contract_rejected' : 'isolation_runtime_failure' });
    else if (job.state === 'pending') transition(job, 'failed', { reason: 'isolation_runtime_unavailable' });
    return outcome;
  } finally {
    job.finishedAt = new Date().toISOString();
    try { run.save(); } catch { ledger.recordPersistence = 'failed'; }
    const cleanupErrors = [];
    await releaseDocker(run, cleanupErrors);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    releaseFiles(run, cleanupErrors);
    ledger.cleanup = cleanupErrors.length ? { state: 'failed', resources: cleanupErrors } : { state: 'removed' };
    if (ledger.recordPersistence !== 'failed') ledger.recordPersistence = 'saved';
    try { run.save(); } catch { ledger.recordPersistence = 'failed'; }
    if (ledger.recordPersistence === 'failed' || cleanupErrors.length) {
      ledger.runStatus = 'incomplete';
      delete outcome.artifacts;
    }
  }
}
