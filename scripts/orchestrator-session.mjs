// One reviewer turn on the Docker path: write the identity and assignment, decide resume/restart, build the
// bridge arguments, and run the session with the run's budgets and prices (W04-07..12 on the real path).
import fs from 'node:fs';
import path from 'node:path';
import { digest } from './agent-session-store.mjs';
import { FAILURE_MESSAGES } from './audit-process.mjs';
import { writeReportFile } from './report-contract.mjs';
import { REVIEW_WORKFLOW } from './review-workflow.mjs';
import { families } from './reviewer-families.mjs';
import { resumeSession } from './orchestrator-resume.mjs';

export function heartbeatReporter(output, name) {
  return (status) => {
    const idle = status.agentIdleMs == null ? 'none yet' : `${Math.floor(status.agentIdleMs / 1000)}s ago`;
    console.log(`     [${name}] heartbeat: ${status.phase}; running ${Math.floor(status.elapsedMs / 1000)}s; last agent activity ${idle}; each pass is bounded by its tool budget.`);
    try { writeReportFile(output, `harness/heartbeat-${name}.json`, `${JSON.stringify({ state: 'running', at: new Date().toISOString(), ...status })}\n`); }
    catch { console.error(`     [${name}] heartbeat record could not be saved; review continues.`); }
  };
}

function bridgeArguments(run, { role, agent, name, surface, identityFile, pass }) {
  const args = ['--docker-bin', run.dockerBin, '--container', run.session.container, '--report-dir', run.output, '--role', role, '--agent', agent, '--identity-file', identityFile, '--reviewers-file', path.join(run.output, 'harness', 'reviewers.json')];
  if (pass) args.push('--pass', String(pass), '--tool-budget', String(run.budgets.toolBudget));
  // Cross-check reviewers span every surface, so their context and plans must too (R-06).
  args.push(...(role === 'auditor' ? ['--auditor', name, '--surface', surface] : ['--surface', 'ALL']));
  return args;
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
  return async ({ name, agent, role, surface, prompt, assignment, logFile, pass, passResume = false }) => {
    if (run.sandboxFailure) throw run.sandboxFailure;
    const reviewer = run.reviewerById.get(agent);
    const identity = { name, agent, role, workflow: REVIEW_WORKFLOW, model: run.request.models[agent], family: reviewer.family, provider: reviewer.provider, sourceDigest: run.sourceDigest, assignmentDigest: digest(assignment), ...(surface ? { surface } : {}) };
    const identityFile = path.join(run.output, 'harness', 'identities', `${name}.json`);
    writeReportFile(run.output, `harness/identities/${name}.json`, JSON.stringify(identity));
    writeReportFile(run.output, `harness/assignments/${name}.json`, JSON.stringify(assignment));
    const plan = run.resume
      ? resumeSession(run.resume, { name, agent, role, identity, prompt, passResume })
      : { directory: path.join(run.output, 'sessions', name), resuming: false, prompt };
    if (plan.reused) return plan.reused;
    const resuming = plan.resuming || (pass > 1 && fs.existsSync(path.join(plan.directory, 'state.json')));
    const bridgeArgs = bridgeArguments(run, { role, agent, name, surface, identityFile, pass });
    const transport = families.has(reviewer.family) ? families.get(reviewer.family).transport : undefined;
    writeReportFile(run.output, `harness/session-${name}.json`, JSON.stringify({ directory: plan.directory, identity, ...(transport ? { transport } : {}) }));
    const result = await run.review({
      directory: plan.directory, identity, bridgeArgs, prompt: plan.prompt, logFile, resume: resuming,
      budgets: run.budgets, prices: run.prices, signal: run.signal, onProgress: heartbeatReporter(run.output, name),
    });
    return { ...recordExit(run.output, name, result), identity, ...(plan.restartedFrom ? { restartedFrom: plan.restartedFrom } : {}) };
  };
}
