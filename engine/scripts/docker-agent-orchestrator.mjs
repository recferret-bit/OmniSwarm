#!/usr/bin/env node
/**
 * docker-agent-orchestrator.mjs
 *
 * Host orchestrator for one Docker-path review:
 * 1. Seals the source, writes the manifest, test catalog, reviewer inventory and initial meta.
 * 2. Runs the phase list (orchestrator-phases.mjs): prepare (one-shot sandbox) -> tests -> review (every job's
 *    passes, orchestrator-review.mjs) -> crosscheck -> phase files (debate, adjudicate, general-review) -> report.
 * 3. Every reviewer session reaches the target only through docker-mcp-bridge.mjs; teardown removes the sandbox.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageTestArtifacts } from './test-artifacts.mjs';
import { callBridgeTool, resolveDockerBin } from './docker-mcp-bridge.mjs';
import { readReportJson, writeReportFile } from './report-files.mjs';
import { createSnapshot, disposeSnapshot } from './worker-isolation.mjs';
import { HOST_DIR } from './sandbox-host-paths.mjs';
import { createProgress, createSticky } from './orchestrator-progress.mjs';
import { runReviewSession } from './agent-session.mjs';
import { REVIEW_WORKFLOW, buildExistingTestCatalog } from './review-workflow.mjs';
import { families } from './reviewer-families.mjs';
import { publishReviewers } from './reviewer-publish.mjs';
import { formatReviewerSpec, reviewersOfMeta } from './reviewer-registry.mjs';
import { assignJobs, defaultAssign, normalizeScope } from './reviewer-plan-assign.mjs';
import { recommendedOrchestrator } from './reviewer-plan.mjs';
import { loadPhases, runPhases } from './orchestrator-phases.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';
import { startOneShotDocker } from './orchestrator-sandbox.mjs';
import { assertResumable } from './orchestrator-resume.mjs';
import { createExecute } from './orchestrator-session.mjs';
import { crosscheckPhase, reviewPhase, servedModels } from './orchestrator-review.mjs';
import { checkBridgeAgents } from './agent-presence.mjs';

export { buildAuditorPrompt } from './orchestrator-prompts.mjs';
export { savedTurnCompleted } from './orchestrator-resume.mjs';
export { startOneShotDocker } from './orchestrator-sandbox.mjs';

function assertRequest(request) {
  if (request.rpc || request.resume) throw new Error('Source security review excludes deployed RPC comparisons and legacy adversarial-session finalization');
  if (request.restartFailed && !request.resumeFrom) throw new Error('--restart-failed requires --resume-from');
  const output = path.resolve(request.out);
  if (output === fs.realpathSync(request.target)) throw new Error('output cannot be the source root');
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('output directory must be empty');
  return output;
}

// Seal the source once: its manifest is what every identity, the bridge's served-source record and resume compare.
function sealSource(request, output) {
  fs.mkdirSync(path.join(output, 'auditors'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(output, 'harness'), { recursive: true, mode: 0o700 });
  const snapshot = createSnapshot(request.target, { exclude: [output] });
  const { manifest } = snapshot;
  writeReportFile(output, 'source-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  writeReportFile(output, 'harness/existing-tests.json', JSON.stringify(buildExistingTestCatalog(snapshot.snapshot, manifest), null, 2));
  disposeSnapshot(snapshot);
  if (request.testArtifacts) stageTestArtifacts(request.testArtifacts, output, manifest.digest);
  return { sourceDigest: manifest.digest, sourceFiles: manifest.files.map((file) => file.path) };
}

// Reviewers come from run-config; requests that predate reviewers (agents + models) map to cli reviewers.
function planJobs(request) {
  const surfaceArg = String(request.surface || 'all').toLowerCase();
  const reviewers = request.reviewers?.length ? request.reviewers : reviewersOfMeta({ agents: request.agents, models: request.models });
  for (const reviewer of reviewers) {
    const verdict = families.check(reviewer);
    if (!verdict.ok) throw new Error(`Reviewer ${reviewer.id}: ${verdict.reason}`);
  }
  const assign = defaultAssign({ assign: request.assign, reviewers: request.reviewers });
  const scope = normalizeScope(request.scope);
  const jobs = assignJobs({ reviewers, surfaceArg, assign, scope }).map(({ name, reviewer, surface }) => ({
    id: crypto.randomUUID(), name, adapter: reviewer.id, family: reviewer.family, provider: reviewer.provider, vendor: reviewer.vendor,
    requestedModel: reviewer.model, surface, state: 'pending',
  }));
  request.models = Object.fromEntries(reviewers.map((r) => [r.id, r.model]));
  request.agents = reviewers.map((r) => r.id);
  return { surfaceArg, scope, reviewers, assign, jobs, ...planJudges(request) };
}

// The judges: the orchestrator (`recommended` is resolved once, here, so the bridge and the debate agree on it)
// and the alternate judge. A scripted judge applies the citation rules in-process; any other judge runs bridge
// sessions, so it is checked like a reviewer and listed in harness/reviewers.json even if it reviews no surface.
// orchestratorRecord is what reviewers.json and meta.json say was asked for.
function planJudges(request, env = process.env) {
  let orchestratorRecord = request.orchestrator || null;
  if (request.orchestrator === 'recommended') {
    const { reviewer } = recommendedOrchestrator({ env });
    orchestratorRecord = { requested: 'recommended', resolved: reviewer ? formatReviewerSpec(reviewer) : null };
    // With none available the debate phase records no_orchestrator_available.
    if (reviewer) request.orchestrator = reviewer;
  }
  const judges = [request.orchestrator, request.alternateJudge].filter((judge) => judge && typeof judge === 'object' && judge.family !== 'scripted');
  for (const judge of judges) {
    const verdict = families.check(judge);
    if (!verdict.ok) throw new Error(`Judge ${judge.id}: ${verdict.reason}`);
  }
  return { judges, orchestratorRecord };
}

// Any review of the bundled fixture is the demo, however it was started (`audit demo` on Docker included).
function isDemo(request) {
  if (request.preset === 'demo' || request.demo === true) return true;
  try { return fs.realpathSync(request.target) === fs.realpathSync(DEMO_FIXTURE); } catch { return false; }
}

function writeInitialRecords(run) {
  const { request, output, published, assign, budgets, jobs, surfaceArg, orchestratorRecord: orchestrator } = run;
  // Reviewers, judges, orchestrator choice and budgets are recorded at plan time (harness/reviewers.json) and in
  // meta.json. `models` stays populated for every reviewer so reports and tools that read the old map keep working.
  run.initialMeta = {
    name: request.name || path.basename(request.target), mode: request.mode || 'local', source: request.source || request.target, surface: surfaceArg, ...(run.scope && run.scope !== 'full' ? { scope: run.scope } : {}),
    agents: request.agents, models: request.models, reviewers: published, orchestrator, assign, budgets, auditors: jobs.map((job) => job.name),
    workerExits: run.workerExits, crosscheckExits: run.crosscheckExits, stageFailures: run.stageFailures, finalized: false, sandboxHardening: 1,
    workflow: REVIEW_WORKFLOW, agentTransport: 'acp_v1', submissionAuthority: 'mcp_commit', ...(isDemo(request) ? { demo: true } : {}),
  };
  writeReportFile(output, 'harness/reviewers.json', `${JSON.stringify({ version: 1, reviewers: published, judges: run.publishedJudges, orchestrator, alternateJudge: request.alternateJudge || null, assign, budgets, preset: request.preset || null }, null, 2)}\n`);
  writeReportFile(output, 'meta.json', JSON.stringify(run.initialMeta, null, 2));
  run.saveWorkers();
}

function createRun(request, output, sealed, planned, options) {
  const { review = runReviewSession, startSandbox = startOneShotDocker } = options;
  const cancellation = new AbortController();
  const run = {
    request, output, ...sealed, ...planned, review, startSandbox, cancellation, signal: cancellation.signal,
    reviewerById: new Map([...planned.judges, ...planned.reviewers].map((r) => [r.id, r])),
    published: publishReviewers(planned.reviewers, process.env),
    publishedJudges: publishReviewers(planned.judges, process.env),
    budgets: request.budgets || null, prices: request.prices || null, dockerBin: resolveDockerBin(),
    stageFailures: [], providerFailures: {}, crosscheckExits: {}, budgetRows: [], costCeilings: new Set(),
    workerExits: Object.fromEntries(planned.jobs.map((j) => [j.name, null])),
    resumeRoot: request.resumeFrom ? fs.realpathSync(request.resumeFrom) : null,
    session: null, sandboxFailure: null,
  };
  run.progress = createProgress({
    output, jobs: planned.jobs, budgets: request.budgets || null, print: options.quietProgress ? null : (line) => console.log(line),
    // On a terminal the status is one sticky last row; elsewhere (a log file, the intake worker) it is lines.
    sticky: options.quietProgress ? null : createSticky(),
  });
  run.saveWorkers = () => { run.progress.refresh(); return writeReportFile(output, 'workers.json', JSON.stringify({ version: 1, policy: 'docker_mcp_bridge', sourceDigest: run.sourceDigest, jobs: run.jobs }, null, 2)); };
  if (run.resumeRoot) {
    const neverStarted = assertResumable({ resumeRoot: run.resumeRoot, sourceDigest: run.sourceDigest, surfaceArg: run.surfaceArg, scope: run.scope, request, jobs: run.jobs });
    run.resume = { resumeRoot: run.resumeRoot, request, output, neverStarted, get session() { return run.session; } };
  }
  run.execute = createExecute(run);
  return run;
}

async function preparePhase(run) {
  console.log('      Starting one-shot Docker sandbox and source scanners...');
  const sealed = createSnapshot(run.request.target, { exclude: [run.output] });
  try {
    if (sealed.manifest.digest !== run.sourceDigest) throw new Error('Source changed before sandbox creation; start a new review');
    run.session = await run.startSandbox({ target: sealed.snapshot, out: run.output });
    run.session.lost?.then((error) => {
      if (!error) return;
      run.sandboxFailure = error;
      run.stageFailures.push('sandbox_unavailable');
      run.cancellation.abort();
    });
  } finally { disposeSnapshot(sealed); }
  console.log(`      Container ${run.session.container} is ready and airgapped (network disconnected).`);
}

async function testsPhase(run) {
  const catalog = readReportJson(run.output, 'harness/existing-tests.json');
  for (const entry of catalog.tests) {
    if (run.cancellation.signal.aborted) break;
    console.log(`      Verifying existing suite: ${entry.description}`);
    await callBridgeTool({ dockerBin: run.dockerBin, container: run.session.container, reportDir: run.output, auditor: 'verification' }, 'run_existing_tests', { test_id: entry.id });
  }
}

function reportPhase(run) {
  const { request, output } = run;
  writeReportFile(output, 'workers.json', `${JSON.stringify({ version: 1, runId: crypto.randomUUID(), policy: 'docker_mcp_bridge', sourceDigest: run.sourceDigest, jobs: run.jobs }, null, 2)}\n`);
  const served = servedModels(run.jobs);
  const finalMeta = {
    ...run.initialMeta, reviewers: run.published.map((r) => (served[r.id] ? { ...r, servedModel: served[r.id] } : r)),
    ref: request.ref || null, commit: request.commit || null, date: new Date().toISOString(), finalized: true, providerFailures: run.providerFailures,
    ...(run.resumeRoot ? { resumedFrom: run.resumeRoot } : {}),
    isolation: { policy: 'docker_mcp_bridge', sourceDigest: run.sourceDigest, liveTransport: 'docker_mcp_stdio', privateOutputs: 'validated', workerManifest: 'workers.json' },
  };
  writeReportFile(output, 'meta.json', `${JSON.stringify(finalMeta, null, 2)}\n`);
}

function phaseContext(run, cleanupSignal) {
  return {
    request: run.request, output: run.output, reviewers: run.reviewers, jobs: run.jobs, assign: run.assign, budgets: run.budgets, surfaceArg: run.surfaceArg,
    stageFailures: run.stageFailures, providerFailures: run.providerFailures, workerExits: run.workerExits, crosscheckExits: run.crosscheckExits,
    cancellation: run.cancellation, get session() { return run.session; }, execute: run.execute,
    progress: run.progress,
    fail(err) {
      run.stageFailures.push(`sandbox_or_orchestrator:${err.message}`);
      console.error(`Orchestrator error: ${err.message}`);
    },
    async teardown() {
      process.removeListener('SIGINT', cleanupSignal);
      process.removeListener('SIGTERM', cleanupSignal);
      if (!run.session) return;
      console.log('      Stopping and removing one-shot Docker container and volumes...');
      await run.session.stop();
    },
  };
}

// Each phase reports its start and end to the progress tracker. A stub phase, or a debate-family phase that had
// nothing to do (no orchestrator), is shown as skipped rather than done.
const DEBATE_PHASES = new Set(['debate', 'adjudicate', 'general-review']);
export function trackPhases(phases, progress) {
  return phases.map((phase) => ({
    ...phase,
    async run(ctx) {
      if (phase.stub) { progress.phaseEnd(phase.name, 'skipped'); return phase.run(ctx); }
      progress.phaseStart(phase.name);
      try { await phase.run(ctx); }
      catch (error) { progress.phaseEnd(phase.name, 'failed'); throw error; }
      progress.phaseEnd(phase.name, DEBATE_PHASES.has(phase.name) && !ctx.debate ? 'skipped' : 'done');
    },
  }));
}

export async function runOrchestratedAudit(request, options = {}) {
  const output = assertRequest(request);
  const sealed = sealSource(request, output);
  const run = createRun(request, output, sealed, planJobs(request), options);
  // Whatever happens below, the status line is released and the snapshot records how the run ended.
  let finished = false;
  try {
    for (const dir of ['sessions', HOST_DIR, 'harness/identities', 'harness/assignments']) fs.mkdirSync(path.join(output, dir), { recursive: true, mode: 0o700 });
    writeInitialRecords(run);
    const cleanupSignal = () => { run.cancellation.abort(); };
    process.on('SIGINT', cleanupSignal);
    process.on('SIGTERM', cleanupSignal);
    const builtin = { prepare: () => preparePhase(run), tests: () => testsPhase(run), review: () => reviewPhase(run), crosscheck: () => crosscheckPhase(run), report: async () => reportPhase(run) };
    const ctx = phaseContext(run, cleanupSignal);
    const outcome = await runPhases(trackPhases(await loadPhases({ builtin, dir: options.phasesDir }), run.progress), ctx);
    const cancelled = run.cancellation.signal.aborted && !run.sandboxFailure;
    run.progress.finish(cancelled ? 'cancelled' : outcome.failed ? 'failed' : run.stageFailures.length ? 'incomplete' : 'finished');
    finished = true;
    return { stageFailures: run.stageFailures, output, cancelled };
  } finally {
    if (!finished) run.progress.finish('failed');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [arg1] = process.argv.slice(2);
  if (arg1 === '--check') {
    const status = checkBridgeAgents();
    console.log(JSON.stringify(status, null, 2));
    process.exit(status.state === 'ready' ? 0 : 2);
  }
  if (!arg1 || !fs.existsSync(arg1)) {
    console.error('usage: docker-agent-orchestrator.mjs <request.json> | --check');
    process.exit(2);
  }
  const request = JSON.parse(fs.readFileSync(arg1, 'utf8'));
  runOrchestratedAudit(request).then(
    ({ stageFailures, cancelled }) => { if (cancelled) process.exitCode = 130; else if (stageFailures.length) process.exitCode = 2; },
    (err) => { console.error(err.message || err); process.exitCode = 2; },
  );
}
