// The review and cross-check phases of the Docker path. Each provider drains its own queue (one active job per
// provider); a job's passes run through the shared pass loop, and its committed report is derived once.
import fs from 'node:fs';
import path from 'node:path';
import { classifyAuditFailure, FAILURE_MESSAGES } from './audit-process.mjs';
import { deriveSubmission, readCanonicalSubmission } from './audit-submission.mjs';
import { loadAuditorFindings, peerClaims } from './crosscheck.mjs';
import { normalizeCrosscheckPayload, renderMarkdownFromFindings } from './docker-mcp-bridge.mjs';
import { buildAuditorPrompt, buildCrosscheckPrompt } from './orchestrator-prompts.mjs';
import { resumePassStart } from './orchestrator-resume.mjs';
import { writeReportFile } from './report-files.mjs';
import { runReviewerPasses } from './reviewer-pass-loop.mjs';
import { hostLogRel } from './sandbox-host-paths.mjs';
import { budgetHealth } from './verification-health.mjs';

const PROVIDER_BLOCKS = ['usage_limit', 'auth_required', 'provider_policy'];
const failureOf = (reason) => ({ reason, message: FAILURE_MESSAGES[reason] });

export async function runProviderQueues(agents, jobs, execute) {
  // Drain every provider before reporting an unexpected error or removing the sandbox.
  const results = await Promise.allSettled(agents.map(async (agent) => {
    for (const job of jobs.filter((job) => job.adapter === agent)) await execute(job);
  }));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function skipJob(run, job) {
  if (run.cancellation.signal.aborted) {
    job.state = run.sandboxFailure ? 'pending' : 'cancelled';
    run.workerExits[job.name] = run.sandboxFailure ? 1 : 130;
    job.failure = run.sandboxFailure ? failureOf('sandbox_unavailable') : undefined;
    run.stageFailures.push(`auditor_cancelled:${job.name}`);
    return true;
  }
  const blocked = run.providerFailures[job.adapter];
  if (!blocked) return false;
  Object.assign(job, { state: 'pending', failure: failureOf(blocked) });
  run.workerExits[job.name] = 1;
  run.stageFailures.push(`auditor_deferred:${job.name}`);
  return true;
}

function recordSession(run, job, res, logFile) {
  Object.assign(job, {
    sessionId: res.sessionId, sessionDirectory: res.directory, transport: res.transport, turnStopReason: res.stopReason,
    failure: run.sandboxFailure ? failureOf('sandbox_unavailable') : res.failure, observedExitCode: res.observedExitCode ?? null,
    turnCode: res.code, elapsedMs: res.elapsedMs, logFile: path.relative(run.output, logFile),
    ...(res.reusedFrom ? { reusedFrom: res.reusedFrom } : {}), ...(res.restartedFrom ? { restartedFrom: res.restartedFrom } : {}),
  });
}

// A committed report is derived even when a later pass failed, so earlier passes' findings are kept.
function deriveCommitted(run, job, identity) {
  const file = path.join(run.output, 'submissions', `${job.name}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const submission = readCanonicalSubmission(run.output, job.name, identity);
    deriveSubmission(run.output, submission, renderMarkdownFromFindings);
    return submission;
  } catch { return 'invalid'; }
}

async function reviewJob(run, job) {
  const logFile = path.join(run.output, hostLogRel(job.name));
  job.state = 'running';
  run.saveWorkers();
  console.log(`  -> [${job.name}] (${job.adapter} @ ${job.requestedModel}) auditing ${job.surface.code} (${job.surface.name})...`);
  const prompt = buildAuditorPrompt({ targetName: run.request.name, auditorName: job.name, surface: job.surface, reportDir: run.output });
  const startPass = resumePassStart({ resumeRoot: run.resumeRoot, output: run.output, name: job.name, passes: run.budgets?.passes });
  const loop = await runReviewerPasses({
    out: run.output, name: job.name, reviewerId: job.adapter, surface: job.surface.code, budgets: run.budgets, files: run.sourceFiles,
    startPass, ceilings: run.costCeilings,
    runPass: ({ pass, brief }) => run.execute({ name: job.name, agent: job.adapter, role: 'auditor', surface: job.surface.code, prompt: brief ? `${prompt}\n${brief}` : prompt, assignment: job.surface, logFile, pass, passResume: pass > 1 || startPass > 1 }),
  });
  run.budgetRows.push(...loop.health);
  const res = loop.result;
  if (res.skipped) { job.failure = failureOf('cost_ceiling'); throw new Error(job.failure.message); }
  job.passesCompleted = loop.passesCompleted;
  if (loop.servedModel) job.servedModel = loop.servedModel;
  recordSession(run, job, res, logFile);
  const submission = res.identity ? deriveCommitted(run, job, res.identity) : null;
  if (submission && submission !== 'invalid') job.submissionHash = submission.hash;
  if (res.code !== 0) { job.failure ||= classifyAuditFailure(res); throw new Error(job.failure.message); }
  if (!submission || submission === 'invalid') {
    job.failure = failureOf(submission === 'invalid' ? 'invalid_report' : 'missing_report');
    throw new Error(job.failure.message);
  }
  run.workerExits[job.name] = 0;
  job.state = 'collected';
  console.log(`  <- [${job.name}] completed and validated.`);
}

export async function reviewPhase(run) {
  console.log(`[2/4] Running ${run.jobs.length} surface audit job(s) in parallel across [${run.request.agents.join(', ')}] via MCP bridge (one active job per provider)...`);
  await runProviderQueues(run.request.agents, run.jobs, async (job) => {
    if (skipJob(run, job)) { run.saveWorkers(); return; }
    try { await reviewJob(run, job); }
    catch (err) {
      run.workerExits[job.name] = job.turnCode || 1;
      job.state = 'failed';
      job.failure ||= Object.hasOwn(FAILURE_MESSAGES, err.reason) ? failureOf(err.reason) : classifyAuditFailure({ code: 0 }, job.observedExitCode == null ? 'setup_error' : 'invalid_report');
      if (PROVIDER_BLOCKS.includes(job.failure.reason)) run.providerFailures[job.adapter] = job.failure.reason;
      run.stageFailures.push(`auditor_error:${job.name}`);
      console.error(`  <- [${job.name}] ${job.failure.message} See ${path.relative(run.output, path.join(run.output, hostLogRel(job.name)))}.`);
    } finally { run.saveWorkers(); }
  });
  if (run.budgets) writeReportFile(run.output, 'harness/budget-health.json', `${JSON.stringify(budgetHealth(run.budgetRows), null, 2)}\n`);
}

async function crosscheckReviewer(run, agent, inbox, containerDir) {
  const claimsJson = `${JSON.stringify(inbox, null, 2)}\n`;
  writeReportFile(run.output, `crosscheck/${agent}.json`, claimsJson);
  fs.writeFileSync(path.join(containerDir, `${agent}.json`), claimsJson);
  const name = `crosscheck-${agent}`;
  console.log(`  -> [${name}] reviewing ${inbox.length} peer claim(s)...`);
  const prompt = buildCrosscheckPrompt({ targetName: run.request.name, agent, claims: inbox });
  const res = await run.execute({ name, agent, role: 'crosscheck', prompt, assignment: inbox, logFile: path.join(run.output, hostLogRel(name)) });
  run.crosscheckExits[agent] = res.code || 1;
  if (res.code !== 0) { if (PROVIDER_BLOCKS.includes(res.failure?.reason)) run.providerFailures[agent] ||= res.failure.reason; throw new Error(res.failure.message); }
  if (!fs.existsSync(path.join(run.output, 'submissions', `${name}.json`))) {
    const missing = new Error(FAILURE_MESSAGES.missing_report);
    missing.reason = 'missing_report';
    throw missing;
  }
  const submission = readCanonicalSubmission(run.output, name, res.identity);
  normalizeCrosscheckPayload(submission.report.payload, inbox);
  deriveSubmission(run.output, submission, renderMarkdownFromFindings);
  run.crosscheckExits[agent] = 0;
  console.log(`  <- [${name}] completed and validated.`);
}

export async function crosscheckPhase(run) {
  // Until teardown the meta keeps finalized:false and every field of the initial meta (R-03): a crash from
  // here on leaves a report that validation treats as an unfinished committed-submission run, never a finalized one.
  writeReportFile(run.output, 'meta.json', `${JSON.stringify({ ...run.initialMeta, ref: run.request.ref || null, commit: run.request.commit || null, date: new Date().toISOString(), finalized: false }, null, 2)}\n`);
  const allClaims = loadAuditorFindings(path.join(run.output, 'auditors'));
  fs.mkdirSync(path.join(run.output, 'crosscheck'), { recursive: true });
  const containerDir = path.join(run.session.hostRunDir, 'crosscheck');
  fs.mkdirSync(containerDir, { recursive: true });
  console.log('[3/4] Running peer cross-checks in parallel via MCP bridge...');
  await runProviderQueues(run.request.agents, run.request.agents.map((adapter) => ({ adapter })), async ({ adapter: agent }) => {
    if (run.cancellation.signal.aborted) return;
    if (run.providerFailures[agent]) { run.crosscheckExits[agent] = 1; run.stageFailures.push(`crosscheck_deferred:${agent}`); return; }
    const inbox = peerClaims(allClaims, run.reviewerById.get(agent));
    if (!inbox.length) return;
    try { await crosscheckReviewer(run, agent, inbox, containerDir); }
    catch (err) {
      run.crosscheckExits[agent] ||= 1;
      if (PROVIDER_BLOCKS.includes(err.reason)) run.providerFailures[agent] ||= err.reason;
      run.stageFailures.push(`crosscheck_error:${agent}`);
      console.error(`  <- [crosscheck-${agent}] error: ${err.message}`);
    }
  });
}

// Workers and served models are copied into meta.reviewers so per-reviewer reports can show them (W03-10).
export function servedModels(jobs) {
  const byReviewer = {};
  for (const job of jobs) if (job.servedModel) byReviewer[job.adapter] ||= job.servedModel;
  return byReviewer;
}
