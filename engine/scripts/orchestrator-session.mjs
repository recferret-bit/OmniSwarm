// One reviewer turn on the Docker path: write the identity and assignment, decide resume/restart, build the
// bridge arguments, and run the session with the run's budgets and prices (W04-07..12 on the real path).
import fs from 'node:fs';
import path from 'node:path';
import { digest } from './agent-session-store.mjs';
import { FAILURE_MESSAGES } from './audit-process.mjs';
import { writeReportFile } from './report-files.mjs';
import { REVIEW_WORKFLOW } from './review-workflow.mjs';
import { families } from './reviewer-families.mjs';
import { resumeSession } from './orchestrator-resume.mjs';
import { STALL_MS } from './orchestrator-progress.mjs';

// The per-session heartbeat line. With the live status line (orchestrator-progress.mjs) printing the run as a
// whole, a session's own line is printed only while it has had no agent activity for STALL_MS, so a stalled
// provider stays visible without thirty-second lines from every healthy session. The heartbeat file is always written.
export function heartbeatReporter(output, name, { quiet = false } = {}) {
  return (status) => {
    const idle = status.agentIdleMs == null ? 'none yet' : `${Math.floor(status.agentIdleMs / 1000)}s ago`;
    if (!quiet || (status.agentIdleMs ?? 0) >= STALL_MS) console.log(`     [${name}] heartbeat: ${status.phase}; running ${Math.floor(status.elapsedMs / 1000)}s; last agent activity ${idle}; each pass is bounded by its tool budget.`);
    try { writeReportFile(output, `harness/heartbeat-${name}.json`, `${JSON.stringify({ state: 'running', at: new Date().toISOString(), ...status })}\n`); }
    catch { console.error(`     [${name}] heartbeat record could not be saved; review continues.`); }
  };
}

// The heartbeat also feeds the live progress snapshot (last agent activity per session).
function withProgress(report, progress, name) {
  if (!progress) return report;
  return (status) => { report(status); progress.activity(name, status); };
}

function bridgeArguments(run, { role, agent, name, surface, identityFile, pass, toolBudget }) {
  const args = ['--docker-bin', run.dockerBin, '--container', run.session.container, '--report-dir', run.output, '--role', role, '--agent', agent, '--identity-file', identityFile, '--reviewers-file', path.join(run.output, 'harness', 'reviewers.json')];
  if (pass) args.push('--pass', String(pass), '--tool-budget', String(toolBudget || run.budgets.toolBudget));
  else if (toolBudget) args.push('--tool-budget', String(toolBudget));
  // Cross-check, debate and judge sessions span every surface, so their context and plans must too (R-06).
  // Every session except a cross-check (named by its reviewer) carries its own name for the bridge identity.
  if (run.scope && run.scope !== 'full') args.push('--scope', run.scope);
  if (role === 'auditor') args.push('--auditor', name, '--surface', surface);
  else if (role === 'crosscheck') args.push('--surface', 'ALL');
  else args.push('--auditor', name, '--surface', 'ALL');
  return args;
}

// One signal that aborts when any input aborts. A single input is returned as itself.
export function linkSignals(signals) {
  const list = signals.filter(Boolean);
  if (list.length === 0) return { signal: undefined, stop() {} };
  if (list.length === 1) return { signal: list[0], stop() {} };
  const controller = new AbortController();
  const abort = () => { if (!controller.signal.aborted) controller.abort(); };
  for (const signal of list) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort);
  }
  return { signal: controller.signal, stop() { for (const signal of list) signal.removeEventListener('abort', abort); } };
}

function recordExit(output, name, result) {
  writeReportFile(output, `harness/heartbeat-${name}.json`, `${JSON.stringify({ state: 'exited', at: new Date().toISOString(), elapsedMs: result.elapsedMs, turnCode: result.code, observedExitCode: result.observedExitCode ?? null, sessionId: result.sessionId, timeLimitMs: null })}\n`);
  if (result.code === 0) return result;
  const reason = Object.hasOwn(FAILURE_MESSAGES, result.failureReason) ? result.failureReason : 'process_error';
  return { ...result, failure: { reason, message: FAILURE_MESSAGES[reason] } };
}

// run: {request, output, reviewerById, sourceDigest, dockerBin, budgets, prices, review, signal, session, resume,
//       sandboxFailure} (session and sandboxFailure are read when a turn starts).
export function createExecute(run) {
  return async ({ name, agent, role, surface, prompt, assignment, logFile, pass, passResume = false, signal }) => {
    if (run.sandboxFailure) throw run.sandboxFailure;
    // reviewerById holds the run's reviewers and its judges (orchestrator, alternate judge).
    const reviewer = run.reviewerById.get(agent);
    if (!reviewer) throw new Error(`${String(agent).slice(0, 80)} is neither a reviewer nor a judge of this run`);
    const identity = { name, agent, role, workflow: REVIEW_WORKFLOW, model: reviewer.model, family: reviewer.family, provider: reviewer.provider, sourceDigest: run.sourceDigest, assignmentDigest: digest(assignment), ...(surface ? { surface } : {}) };
    const identityFile = path.join(run.output, 'harness', 'identities', `${name}.json`);
    writeReportFile(run.output, `harness/identities/${name}.json`, JSON.stringify(identity));
    writeReportFile(run.output, `harness/assignments/${name}.json`, JSON.stringify(assignment));
    const plan = run.resume
      ? resumeSession(run.resume, { name, agent, role, identity, prompt, passResume })
      : { directory: path.join(run.output, 'sessions', name), resuming: false, prompt };
    if (plan.reused) return plan.reused;
    const resuming = plan.resuming || (pass > 1 && fs.existsSync(path.join(plan.directory, 'state.json')));
    const crosscheckBudget = role === 'crosscheck' && run.budgets
      ? Math.min(120, Math.max(Number(run.budgets.toolBudget) || 40, (Array.isArray(assignment) ? assignment.length : 0) + 20))
      : undefined;
    const bridgeArgs = bridgeArguments(run, { role, agent, name, surface, identityFile, pass, toolBudget: crosscheckBudget });
    const transport = families.has(reviewer.family) ? families.get(reviewer.family).transport : undefined;
    writeReportFile(run.output, `harness/session-${name}.json`, JSON.stringify({ directory: plan.directory, identity, ...(transport ? { transport } : {}) }));
    const linked = linkSignals([run.signal, signal]);
    const sessionBudgets = !run.budgets
      ? run.budgets
      : role === 'crosscheck'
        ? { ...run.budgets, toolBudget: crosscheckBudget }
        : (role === 'debater' || role === 'orchestrator') && Number(assignment?.budget) > 0
          ? { ...run.budgets, toolBudget: Number(assignment.budget) }
          : run.budgets;
    try {
      const result = await run.review({
        directory: plan.directory, identity, bridgeArgs, prompt: plan.prompt, logFile, resume: resuming,
        budgets: sessionBudgets, prices: run.prices, signal: linked.signal, onProgress: withProgress(heartbeatReporter(run.output, name, { quiet: Boolean(run.progress) }), run.progress, name),
      });
      return { ...recordExit(run.output, name, result), identity, ...(plan.restartedFrom ? { restartedFrom: plan.restartedFrom } : {}) };
    } finally {
      linked.stop();
      run.progress?.sessionEnd(name);
    }
  };
}
