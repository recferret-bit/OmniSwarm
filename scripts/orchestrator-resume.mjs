// --resume-from and --restart-failed for the Docker path. A resumed run reuses a saved session only for the
// exact source, reviewer, model and assignment; committed reports of finished jobs are reused as they are,
// and a job whose later pass failed restarts at that pass with its earlier passes kept (W04-05).
// R-07: restart decisions read recorded structured reasons only, never log text.
import fs from 'node:fs';
import path from 'node:path';
import { digest } from './agent-session-store.mjs';
import { commitSubmission, readCanonicalSubmission } from './audit-submission.mjs';
import { readReportJson, readReportText, writeReportFile } from './report-contract.mjs';
import { REVIEW_WORKFLOW } from './review-workflow.mjs';
import { hostLogRel } from './sandbox-host-paths.mjs';

const BLOCKING = ['provider_policy', 'usage_limit', 'auth_required', 'provider_error'];
const DIGEST_FILE = 'harness/source-read-digest.json';

export function previousSessionDirectory(root, name) {
  const pointer = `harness/session-${name}.json`;
  if (!fs.existsSync(path.join(root, pointer))) return path.join(root, 'sessions', name);
  const saved = readReportJson(root, pointer);
  if (typeof saved.directory !== 'string' || !path.isAbsolute(saved.directory)) throw new Error('Invalid saved session directory');
  return saved.directory;
}

// Repair only the historical classifier bug: a committed turn ended normally,
// but replayed prose was mistaken for a provider error. Actual RPC errors stay failed.
export function savedTurnCompleted(root, name, directory) {
  try {
    const state = readReportJson(directory, 'state.json');
    if (state.observedExitCode !== 0 || !['usage_limit', 'provider_policy', 'auth_required', 'mcp_unavailable'].includes(state.failureReason)) return false;
    const log = readReportText(root, hostLogRel(name), 8 * 1024 * 1024);
    let complete = false;
    for (const line of log.split('\n')) {
      let frame; try { frame = JSON.parse(line); } catch { continue; }
      if (frame?.jsonrpc !== '2.0' || frame.id == null) continue;
      if (frame.error) return false;
      if (frame.result?.stopReason) complete = frame.result.stopReason === 'end_turn';
    }
    return complete;
  } catch { return false; }
}

const priorJob = (resumeRoot, name) => readReportJson(resumeRoot, 'workers.json').jobs?.find((row) => row.name === name);
const priorExit = (meta, role, name, agent) => (role === 'auditor' ? meta.workerExits?.[name] : meta.crosscheckExits?.[agent]);

// Same source, workflow, surfaces, reviewers and models, and every started job has matching saved state.
// Returns the names of jobs that never started in the previous run.
export function assertResumable({ resumeRoot, sourceDigest, surfaceArg, request, jobs }) {
  const previous = readReportJson(resumeRoot, 'meta.json');
  const sameRun = readReportJson(resumeRoot, 'source-manifest.json').digest === sourceDigest && previous.workflow === REVIEW_WORKFLOW
    && previous.surface === surfaceArg && JSON.stringify(previous.agents) === JSON.stringify(request.agents)
    && request.agents.every((agent) => previous.models?.[agent] === request.models[agent]);
  if (!sameRun) throw new Error('Resume requires the same source digest, surfaces, reviewers and requested models');
  const neverStarted = new Set();
  for (const job of jobs) {
    const directory = previousSessionDirectory(resumeRoot, job.name);
    if (!fs.existsSync(path.join(directory, 'state.json'))) {
      const prior = priorJob(resumeRoot, job.name);
      if (prior?.state !== 'pending' && !(prior?.state === 'cancelled' && prior.turnCode == null && !prior.sessionId)) throw new Error('Missing saved state for a previously started reviewer');
      neverStarted.add(job.name);
      continue;
    }
    const saved = readReportJson(directory, 'state.json').identity;
    if (saved?.workflow !== REVIEW_WORKFLOW || saved?.agent !== job.adapter || saved?.model !== job.requestedModel || saved?.sourceDigest !== sourceDigest || saved?.assignmentDigest !== digest(job.surface)) throw new Error('Saved session does not match the resumed assignment');
  }
  return neverStarted;
}

// The pass a resumed job starts at. A job whose pass k failed restarts at pass k: passes 1..k-1 are copied
// forward as archived submissions, and the last of them is what the loop restores if pass k submits nothing.
export function resumePassStart({ resumeRoot, output, name, passes }) {
  if (!resumeRoot || !passes) return 1;
  const meta = readReportJson(resumeRoot, 'meta.json');
  const done = Number(priorJob(resumeRoot, name)?.passesCompleted) || 0;
  if (meta.workerExits?.[name] === 0 || done < 1 || done >= passes) return 1;
  const from = path.join(resumeRoot, 'submissions');
  fs.mkdirSync(path.join(output, 'submissions'), { recursive: true, mode: 0o700 });
  for (let k = 1; k < done; k++) copyIfPresent(path.join(from, `${name}-pass-${k}.json`), path.join(output, 'submissions', `${name}-pass-${k}.json`));
  copyIfPresent(path.join(from, `${name}.json`), path.join(output, 'submissions', `${name}-pass-${done}.json`));
  return done + 1;
}

function copyIfPresent(from, to) {
  if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
}

// A reused committed report was read from the same sealed source in the previous run; its served-source
// record comes with it, so the R-02 check does not treat the reuse as a run without reads.
function carryServedDigest(resumeRoot, output) {
  if (fs.existsSync(path.join(output, DIGEST_FILE)) || !fs.existsSync(path.join(resumeRoot, DIGEST_FILE))) return;
  writeReportFile(output, DIGEST_FILE, readReportText(resumeRoot, DIGEST_FILE, 64 * 1024 * 1024));
}

function restartContext(state, { name, role, agent, identity, prompt, priorDirectory, savedState }) {
  const { resumeRoot, output } = state;
  const meta = readReportJson(resumeRoot, 'meta.json');
  const failure = role === 'auditor' ? priorJob(resumeRoot, name)?.failure?.reason : meta.providerFailures?.[agent];
  const blocked = [failure, savedState.failureReason, meta.providerFailures?.[agent]].find((reason) => BLOCKING.includes(reason));
  if (blocked) throw Object.assign(new Error('A provider refusal, quota, login or unresolved provider error cannot be restarted in a new conversation'), { reason: blocked });
  if (role !== 'auditor' || !fs.existsSync(path.join(resumeRoot, 'submissions', `${name}.json`))) return { restartedFrom: priorDirectory, prompt };
  const prior = readCanonicalSubmission(resumeRoot, name, identity);
  const file = `prior-${name}.json`, notes = JSON.stringify(prior.report.payload);
  writeReportFile(output, `harness/${file}`, notes);
  const directory = path.join(state.session.hostRunDir, 'harness');
  fs.mkdirSync(directory, { recursive: true }); fs.chmodSync(directory, 0o755);
  fs.writeFileSync(path.join(directory, file), notes, { mode: 0o644 }); fs.chmodSync(path.join(directory, file), 0o644);
  return { restartedFrom: priorDirectory, prompt: `${prompt}\n\nThe failed session left untrusted candidate notes at /out/harness/${file}. They are leads only: validate them against the captured source during the full assigned review, add omissions and discard unsupported claims. Submit a new complete report; the old notes are not an accepted review.` };
}

// Decide how one execute() call continues a previous run. Returns the session directory, whether the saved
// conversation is loaded, the (possibly extended) prompt, and `reused` when a committed report is reused as is.
// `passResume`: the job restarts at a later pass, so the old report stays archived instead of being recommitted.
export function resumeSession(state, { name, agent, role, identity, prompt, passResume = false }) {
  const { resumeRoot, request, output, neverStarted } = state;
  const plan = { directory: path.join(output, 'sessions', name), resuming: false, restartedFrom: undefined, prompt };
  const priorDirectory = previousSessionDirectory(resumeRoot, name);
  if (fs.existsSync(path.join(priorDirectory, 'state.json'))) {
    const savedState = readReportJson(priorDirectory, 'state.json');
    const exit = priorExit(readReportJson(resumeRoot, 'meta.json'), role, name, agent);
    if (request.restartFailed && exit !== 0) Object.assign(plan, restartContext(state, { name, role, agent, identity, prompt, priorDirectory, savedState }));
    else if (savedState.identity?.assignmentDigest === identity.assignmentDigest) Object.assign(plan, { directory: priorDirectory, resuming: true });
  }
  if (role === 'auditor' && !plan.resuming && !plan.restartedFrom && !neverStarted.has(name)) throw new Error(`No matching saved session for ${name}`);
  if (!plan.resuming || passResume || !fs.existsSync(path.join(resumeRoot, 'submissions', `${name}.json`))) return plan;
  const previous = readCanonicalSubmission(resumeRoot, name, identity);
  const exit = priorExit(readReportJson(resumeRoot, 'meta.json'), role, name, agent);
  const recoveredCompletion = exit !== 0 && savedTurnCompleted(resumeRoot, name, plan.directory);
  // Keep committed evidence; a failed turn still needs a fresh successful turn, told not to resubmit.
  commitSubmission(output, name, identity, previous.report.payload, previous.report.summary);
  if (exit !== 0 && !recoveredCompletion) return plan;
  carryServedDigest(resumeRoot, output);
  writeReportFile(output, `harness/session-${name}.json`, JSON.stringify({ directory: plan.directory, identity }));
  const saved = readReportJson(plan.directory, 'state.json');
  plan.reused = { code: 0, observedExitCode: 0, elapsedMs: 0, sessionId: saved.sessionId, directory: plan.directory, transport: recoveredCompletion ? 'recovered_protocol_completion' : 'reused_committed_submission', stopReason: 'reused', identity, reusedFrom: resumeRoot, recoveredCompletion };
  return plan;
}
