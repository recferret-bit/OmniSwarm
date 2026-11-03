#!/usr/bin/env node
// Offline review of the bundled demo fixture without a sandbox image: `audit demo --no-docker` and
// `audit run` under OMNI_DEMO_HOST=1. The bridge serves the fixture read-only from the host (--demo-host);
// target tests are not executed. Passes, budgets, usage rows and budget health come from the same pass
// loop as the Docker path (reviewer-pass-loop.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReviewSession } from './agent-session.mjs';
import { digest } from './agent-session-store.mjs';
import { deriveSubmission, readCanonicalSubmission } from './audit-submission.mjs';
import { digestTree } from './bridge-tools-common.mjs';
import { renderMarkdownFromFindings } from './docker-mcp-bridge.mjs';
import { writeReportFile } from './report-contract.mjs';
import { REVIEW_WORKFLOW } from './review-workflow.mjs';
import { families } from './reviewer-families.mjs';
import { withKeyFingerprint } from './reviewer-env.mjs';
import { runReviewerPasses } from './reviewer-pass-loop.mjs';
import { assignJobs, defaultAssign } from './reviewer-plan-assign.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';
import { budgetHealth } from './verification-health.mjs';

const DEFAULT_BUDGETS = Object.freeze({ passes: 2, toolBudget: 40, maxCostUsd: null });
const CODE_FILE = /\.(rs|ts|js|mjs)$/;

// Files the pass-2 brief may list as unread: fixture source, never its answer key.
function briefFiles(files) {
  return files.map((file) => file.path).filter((rel) => CODE_FILE.test(rel) && !rel.split('/').some((part) => part === 'answers' || part === 'node_modules'));
}

function hostIdentity(job, sourceDigest) {
  return {
    name: job.name, agent: job.reviewer.id, role: 'auditor', workflow: REVIEW_WORKFLOW,
    model: job.reviewer.model, family: job.reviewer.family, provider: job.reviewer.provider,
    sourceDigest, assignmentDigest: digest(job.surface), surface: job.surface.code,
  };
}

function bridgeArgs({ fixture, out, job, identityRel, pass, toolBudget }) {
  return [
    '--demo-host', fixture, '--report-dir', out, '--role', 'auditor', '--auditor', job.name,
    '--agent', job.reviewer.id, '--surface', job.surface.code, '--pass', String(pass), '--tool-budget', String(toolBudget),
    '--identity-file', path.join(out, identityRel), '--reviewers-file', path.join(out, 'harness', 'reviewers.json'),
  ];
}

function writePlanRecords(run) {
  const { out, request, published, budgets, assign, seen, jobs } = run;
  writeReportFile(out, 'source-manifest.json', `${JSON.stringify({ version: 1, digest: seen.digest, files: seen.files }, null, 2)}\n`);
  writeReportFile(out, 'harness/reviewers.json', `${JSON.stringify({ version: 1, reviewers: published, budgets, assign, preset: request.preset || null }, null, 2)}\n`);
  writeReportFile(out, 'harness/sandbox.md', '# Sandbox\n\n| demo-host | ran | target tests are not executed on the host snapshot |\n');
  run.meta = {
    name: 'demo-fixture', mode: 'local', source: DEMO_FIXTURE, surface: run.surfaceArg, demo: true,
    agents: published.map((r) => r.id), models: Object.fromEntries(published.map((r) => [r.id, r.model])),
    reviewers: published, assign, budgets, preset: request.preset || null, auditors: jobs.map((job) => job.name),
    workerExits: Object.fromEntries(jobs.map((job) => [job.name, null])), crosscheckExits: {}, stageFailures: [],
    finalized: false, sandboxHardening: 1, workflow: REVIEW_WORKFLOW, submissionAuthority: 'mcp_commit',
  };
  writeReportFile(out, 'meta.json', `${JSON.stringify(run.meta, null, 2)}\n`);
}

async function reviewHostJob(run, job, env) {
  const { out, budgets } = run;
  const identity = hostIdentity(job, run.seen.digest);
  const identityRel = `harness/identities/${job.name}.json`;
  writeReportFile(out, identityRel, JSON.stringify(identity));
  writeReportFile(out, `harness/assignments/${job.name}.json`, JSON.stringify(job.surface));
  const directory = path.join(out, 'sessions', job.name);
  writeReportFile(out, `harness/session-${job.name}.json`, JSON.stringify({ directory, identity, transport: families.get(job.reviewer.family).transport }));
  const loop = await runReviewerPasses({
    out, name: job.name, reviewerId: job.reviewer.id, surface: job.surface.code, budgets, files: run.files, ceilings: run.ceilings,
    runPass: ({ pass, brief, resume }) => runReviewSession({
      directory, identity, env, budgets, prices: run.request.prices || null, resume,
      bridgeArgs: bridgeArgs({ fixture: run.fixture, out, job, identityRel, pass, toolBudget: budgets.toolBudget }),
      prompt: `${brief}\nReview ${job.surface.code} as ${job.reviewer.provider}.`,
      logFile: path.join(out, 'harness', 'host', `agent-${job.name}-pass-${pass}.log`),
    }),
  });
  run.healthRows.push(...loop.health);
  const committed = fs.existsSync(path.join(out, 'submissions', `${job.name}.json`));
  if (committed) deriveSubmission(out, readCanonicalSubmission(out, job.name, identity), renderMarkdownFromFindings);
  // A session error fails the run; a budget or cost stop without a report is recorded (budget health) and kept.
  const state = loop.result.code !== 0 ? 'failed' : committed && !loop.result.skipped ? 'collected' : 'incomplete';
  run.meta.workerExits[job.name] = state === 'collected' ? 0 : loop.result.code || 1;
  if (state !== 'collected') run.meta.stageFailures.push(`auditor_${state === 'failed' ? 'error' : 'incomplete'}:${job.name}`);
  const reason = loop.result.skipped ? 'cost_ceiling' : loop.result.failureReason || (committed ? 'process_error' : 'missing_report');
  return { name: job.name, adapter: job.reviewer.id, state, passesCompleted: loop.passesCompleted, turnCode: loop.result.code ?? null, ...(loop.servedModel ? { servedModel: loop.servedModel } : {}), ...(state === 'collected' ? {} : { failure: { reason } }) };
}

export async function runHostReview(request, env = process.env) {
  const fixture = fs.realpathSync(DEMO_FIXTURE);
  if (fs.realpathSync(request.target) !== fixture) throw new Error('demo-host serves only the bundled fixture');
  const out = path.resolve(request.out);
  for (const dir of ['harness/identities', 'harness/assignments', 'harness/host', 'sessions', 'auditors']) fs.mkdirSync(path.join(out, dir), { recursive: true, mode: 0o700 });
  const reviewers = request.reviewers;
  const surfaceArg = request.surface || 's1';
  const assign = defaultAssign({ assign: request.assign, reviewers });
  const seen = digestTree(fixture);
  const run = {
    out, request, fixture, seen, surfaceArg, assign, budgets: request.budgets || DEFAULT_BUDGETS,
    published: reviewers.map((reviewer) => withKeyFingerprint(reviewer, families.envAllowlist(reviewer), env)),
    jobs: assignJobs({ reviewers, surfaceArg, assign }), files: briefFiles(seen.files), healthRows: [], ceilings: new Set(),
  };
  writePlanRecords(run);
  const workers = [];
  for (const job of run.jobs) workers.push(await reviewHostJob(run, job, env));
  const health = budgetHealth(run.healthRows);
  writeReportFile(out, 'harness/budget-health.json', `${JSON.stringify(health, null, 2)}\n`);
  writeReportFile(out, 'workers.json', `${JSON.stringify({ version: 1, policy: 'demo_host_bridge', sourceDigest: seen.digest, jobs: workers }, null, 2)}\n`);
  const served = Object.fromEntries(workers.filter((w) => w.servedModel).map((w) => [w.adapter, w.servedModel]));
  run.meta.reviewers = run.published.map((r) => (served[r.id] ? { ...r, servedModel: served[r.id] } : r));
  writeReportFile(out, 'meta.json', `${JSON.stringify({ ...run.meta, finalized: true, date: new Date().toISOString() }, null, 2)}\n`);
  const failed = workers.filter((w) => w.state === 'failed');
  if (failed.length) throw new Error(`${failed.map((w) => `${w.name} (${w.failure.reason})`).join(', ')} did not complete; partial output kept in ${out}`);
  return { out, health, jobs: workers };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  runHostReview(request).then(() => { process.stdout.write(`Host review saved to: ${request.out}\n`); }, (error) => { process.stderr.write(`${error.stack || error}\n`); process.exit(1); });
}
