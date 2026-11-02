#!/usr/bin/env node
// Offline multi-pass review of the bundled demo fixture. Used when OMNI_DEMO_HOST=1 so the
// budget check does not need a sandbox image. The bridge still serves the fixture read-only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReviewSession } from './agent-session.mjs';
import { digest } from './agent-session-store.mjs';
import { digestTree } from './bridge-tools-common.mjs';
import { assignJobs } from './reviewer-plan.mjs';
import { writeReportFile, readReportJson } from './report-contract.mjs';
import { REVIEW_WORKFLOW } from './review-workflow.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';
import { renderBrief, passRole } from './review-briefs.mjs';
import { archivePassSubmission, passCalls, writePassUsage } from './review-passes.mjs';
import { budgetHealth } from './verification-health.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function surfaceSlug(surface) {
  return String(surface?.id || surface || 's1').toLowerCase();
}

function readAgent(directory) {
  try { return readReportJson(path.join(directory, 'workspace'), 'api-session.json'); }
  catch { return {}; }
}

export async function runHostReview(request, env = process.env) {
  const fixture = fs.realpathSync(DEMO_FIXTURE);
  if (fs.realpathSync(request.target) !== fixture) throw new Error('demo-host serves only the bundled fixture');
  const out = path.resolve(request.out);
  fs.mkdirSync(path.join(out, 'harness', 'identities'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(out, 'harness', 'host'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(out, 'sessions'), { recursive: true, mode: 0o700 });
  const reviewers = request.reviewers;
  const budgets = request.budgets || { passes: 2, toolBudget: 40, maxCostUsd: null };
  const passes = budgets.passes;
  const toolBudget = budgets.toolBudget;
  const seen = digestTree(fixture);
  const jobs = assignJobs({ reviewers, surfaceArg: request.surface || 's1', assign: request.assign || 'matrix' });
  writeReportFile(out, 'source-manifest.json', `${JSON.stringify({ version: 1, digest: seen.digest, files: seen.files }, null, 2)}\n`);
  writeReportFile(out, 'harness/reviewers.json', `${JSON.stringify({ version: 1, reviewers, budgets, assign: request.assign || 'matrix' }, null, 2)}\n`);
  writeReportFile(out, 'harness/sandbox.md', '# Sandbox\n\n| demo-host | ran | target tests are not executed on the host snapshot |\n');
  const files = [];
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'answers' || ent.name === 'node_modules') continue;
      const next = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), next);
      else if (/\.(rs|ts|js|mjs)$/.test(ent.name)) files.push(next);
    }
  };
  walk(fixture, '');
  const healthRows = [];
  const ceilings = new Set();
  for (const job of jobs) {
    const identity = {
      name: job.name, agent: job.reviewer.id, role: 'auditor', workflow: REVIEW_WORKFLOW,
      model: job.reviewer.model, family: job.reviewer.family, provider: job.reviewer.provider,
      sourceDigest: seen.digest, assignmentDigest: digest(job.surface), surface: job.surface.code,
    };
    const identityRel = `harness/identities/${job.name}.json`;
    writeReportFile(out, identityRel, JSON.stringify(identity));
    const directory = path.join(out, 'sessions', job.name);
    let completed = 0;
    for (let pass = 1; pass <= passes; pass++) {
      const startedAt = new Date().toISOString();
      if (ceilings.has(job.reviewer.id)) {
        writePassUsage(out, { reviewerId: job.reviewer.id, surface: surfaceSlug(job.surface), pass, role: passRole(pass), calls: 0, stop: 'cost', costSource: 'none', startedAt, endedAt: startedAt, skipped: 'cost_ceiling' });
        continue;
      }
      if (pass > 1) archivePassSubmission(out, job.name, pass - 1);
      const prior = passCalls(out, job.reviewer.id, job.surface.code, pass - 1);
      const brief = renderBrief({ pass, passes, toolBudget, filesRead: prior.filesRead || [], files });
      const bridgeArgs = [
        '--demo-host', fixture, '--report-dir', out, '--role', 'auditor', '--auditor', job.name,
        '--agent', job.reviewer.id, '--surface', job.surface.code, '--pass', String(pass), '--tool-budget', String(toolBudget),
        '--identity-file', path.join(out, identityRel), '--reviewers-file', path.join(out, 'harness', 'reviewers.json'),
      ];
      const result = await runReviewSession({
        directory, identity, bridgeArgs, env, budgets, prices: request.prices || null, resume: pass > 1,
        prompt: `${brief}\nReview ${job.surface.code} as ${job.reviewer.provider}.`,
        logFile: path.join(out, 'harness', 'host', `agent-${job.name}-pass-${pass}.log`),
      });
      const record = passCalls(out, job.reviewer.id, job.surface.code, pass);
      const agent = readAgent(directory);
      const agentStop = agent.stop || null;
      const rows = Array.isArray(agent.usage) ? agent.usage : [];
      const submitted = fs.existsSync(path.join(out, 'submissions', `${job.name}.json`));
      let stop = agentStop === 'cost' ? 'cost' : agentStop === 'budget' ? 'budget' : submitted ? (record.calls >= toolBudget ? 'budget' : 'submitted') : 'error';
      if (result.code !== 0 && stop !== 'cost') stop = 'error';
      const endedAt = new Date().toISOString();
      const costSource = rows.some((row) => row.costSource === 'reported') ? 'reported' : rows.some((row) => row.costSource === 'estimated') ? 'estimated' : 'none';
      writePassUsage(out, {
        reviewerId: job.reviewer.id, surface: surfaceSlug(job.surface), pass, role: passRole(pass),
        calls: record.calls, tokensIn: rows.reduce((n, row) => n + (Number(row.prompt_tokens) || 0), 0),
        tokensOut: rows.reduce((n, row) => n + (Number(row.completion_tokens) || 0), 0),
        cost: rows.reduce((n, row) => n + (Number(row.cost) || 0), 0),
        stop, costSource, startedAt, endedAt,
      });
      healthRows.push({ reviewer: job.reviewer.id, stop, submitted: stop === 'cost' ? false : submitted });
      if (stop === 'cost') ceilings.add(job.reviewer.id);
      if (result.code !== 0 && stop !== 'cost') throw new Error(`${job.name} pass ${pass} failed: ${result.failureReason || result.code}`);
      completed = pass;
    }
    job.passesCompleted = completed;
  }
  const health = budgetHealth(healthRows);
  writeReportFile(out, 'harness/budget-health.json', `${JSON.stringify(health, null, 2)}\n`);
  writeReportFile(out, 'workers.json', `${JSON.stringify({ version: 1, jobs: jobs.map((job) => ({ name: job.name, adapter: job.reviewer.id, state: 'collected', passesCompleted: job.passesCompleted, turnCode: 0 })) }, null, 2)}\n`);
  writeReportFile(out, 'meta.json', `${JSON.stringify({ name: 'demo-fixture', demo: true, surface: request.surface || 's1', reviewers, budgets, agents: reviewers.map((r) => r.id), auditors: jobs.map((j) => j.name), workflow: REVIEW_WORKFLOW }, null, 2)}\n`);
  return { out, health, jobs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  runHostReview(request).then(() => { process.stdout.write(`Host review saved to: ${request.out}\n`); }, (error) => { process.stderr.write(`${error.stack || error}\n`); process.exit(1); });
}
