#!/usr/bin/env node
// ./bin/audit demo — scripted reviewers on the bundled fixture only.
// Docker present: the normal sandbox. Docker absent (or --no-docker): the bridge serves that
// fixture from the host and every report page is stamped DEMO — not a review.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReviewSession } from './agent-session.mjs';
import { digest } from './agent-session-store.mjs';
import { digestTree } from './bridge-tools-common.mjs';
import { resolveDockerBin } from './docker-mcp-bridge.mjs';
import { assignJobs } from './reviewer-plan.mjs';
import { parseReviewerList } from './reviewer-registry.mjs';
import { writeReportFile } from './report-contract.mjs';
import { REVIEW_WORKFLOW } from './review-workflow.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEMO_REVIEWERS = ['scripted:baseline', 'scripted:paranoid', 'scripted:lazy', 'scripted:wrong'];

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function dockerReady() {
  const bin = resolveDockerBin();
  const result = spawnSync(bin, ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 8000 });
  return result.status === 0;
}

function rejectForeignTarget(argv) {
  if (argv.some((arg) => ['--repo', '--path', '-r', '--github', '--gh', '-g'].includes(arg))) {
    process.stderr.write('demo runs only the bundled fixture\n');
    return true;
  }
  return false;
}

async function runHostDemo({ out, surface, env }) {
  fs.mkdirSync(path.join(out, 'harness', 'identities'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(out, 'harness', 'host'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(out, 'sessions'), { recursive: true, mode: 0o700 });
  const reviewers = parseReviewerList(DEMO_REVIEWERS);
  const seen = digestTree(DEMO_FIXTURE);
  const jobs = assignJobs({ reviewers, surfaceArg: surface, assign: 'matrix' });
  writeReportFile(out, 'source-manifest.json', `${JSON.stringify({ version: 1, digest: seen.digest, files: seen.files }, null, 2)}\n`);
  writeReportFile(out, 'harness/reviewers.json', `${JSON.stringify({ version: 1, reviewers, assign: 'matrix', preset: 'demo' }, null, 2)}\n`);
  writeReportFile(out, 'harness/sandbox.md', '# Sandbox\n\n| demo-host | ran | target tests are not executed on the host snapshot |\n');
  const workerExits = {};
  const meta = {
    name: 'demo-fixture', mode: 'local', source: DEMO_FIXTURE, surface, demo: true,
    agents: reviewers.map((reviewer) => reviewer.id),
    models: Object.fromEntries(reviewers.map((reviewer) => [reviewer.id, reviewer.model])),
    reviewers, assign: 'matrix', preset: 'demo', auditors: jobs.map((job) => job.name),
    workerExits, finalized: false, sandboxHardening: 1, workflow: REVIEW_WORKFLOW,
  };
  writeReportFile(out, 'meta.json', `${JSON.stringify(meta, null, 2)}\n`);
  for (const job of jobs) {
    const identity = {
      name: job.name, agent: job.reviewer.id, role: 'auditor', workflow: REVIEW_WORKFLOW,
      model: job.reviewer.model, family: job.reviewer.family, provider: job.reviewer.provider,
      sourceDigest: seen.digest, assignmentDigest: digest(job.surface), surface: job.surface.code,
    };
    const identityRel = `harness/identities/${job.name}.json`;
    writeReportFile(out, identityRel, JSON.stringify(identity));
    const bridgeArgs = [
      '--demo-host', DEMO_FIXTURE, '--report-dir', out, '--role', 'auditor', '--auditor', job.name,
      '--agent', job.reviewer.id, '--surface', job.surface.code,
      '--identity-file', path.join(out, identityRel),
      '--reviewers-file', path.join(out, 'harness', 'reviewers.json'),
    ];
    const directory = path.join(out, 'sessions', job.name);
    writeReportFile(out, `harness/session-${job.name}.json`, JSON.stringify({ directory, identity, transport: 'api-acp' }));
    const result = await runReviewSession({
      directory, identity, bridgeArgs, env,
      prompt: `Scripted ${job.reviewer.provider} review of surface ${job.surface.code}. Use the audit bridge and submit.`,
      logFile: path.join(out, 'harness', 'host', `agent-${job.name}.log`),
    });
    workerExits[job.name] = result.code;
    if (result.code !== 0) throw new Error(`${job.name} failed: ${result.failureReason || result.code}`);
  }
  meta.workerExits = workerExits;
  meta.finalized = true;
  writeReportFile(out, 'meta.json', `${JSON.stringify(meta, null, 2)}\n`);
  writeReportFile(out, 'workers.json', `${JSON.stringify({ version: 1, jobs: jobs.map((job) => ({ name: job.name, adapter: job.reviewer.id, state: 'collected', turnCode: 0 })) }, null, 2)}\n`);
  const html = spawnSync(process.execPath, [path.join(HERE, 'generate-html-report.mjs'), out], { encoding: 'utf8' });
  const report = path.join(out, 'report.html');
  if (!fs.existsSync(report) || !fs.readFileSync(report, 'utf8').includes('DEMO — not a review')) {
    fs.writeFileSync(report, '<!DOCTYPE html><html><body><p>DEMO — not a review</p></body></html>\n');
  }
  return html.status === 0 || fs.readFileSync(report, 'utf8').includes('DEMO — not a review');
}

export async function runDemo(argv = process.argv.slice(2), env = process.env) {
  if (rejectForeignTarget(argv)) return 2;
  const surface = flag(argv, '--surface') || 'all';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const out = path.resolve(flag(argv, '--out') || path.join(ROOT, 'reports', `${stamp}-demo-fixture`));
  if (fs.existsSync(out) && fs.readdirSync(out).length) {
    process.stderr.write('demo: output directory must be empty\n');
    return 2;
  }
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const host = argv.includes('--no-docker') || env.OMNI_DEMO_HOST === '1' || !dockerReady();
  if (!host) {
    const result = spawnSync('bash', [
      path.join(HERE, 'orchestrate.sh'), '--target', DEMO_FIXTURE, '--out', out, '--name', 'demo-fixture',
      '--surface', surface, '--reviewers', DEMO_REVIEWERS.join(','), '--orchestrator', 'scripted:judge',
      '--assign', 'matrix', '--passes', '1', '--tool-budget', '10',
    ], { stdio: 'inherit', env: { ...env, OMNI_DEMO: '1' } });
    return result.status === 0 ? 0 : result.status || 1;
  }
  process.stdout.write(`DEMO — not a review\nHost snapshot of ${DEMO_FIXTURE}\n`);
  try {
    await runHostDemo({ out, surface, env: { ...env, OMNI_DEMO: '1' } });
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    return 1;
  }
  process.stdout.write(`Demo report saved to: ${out}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDemo().then((code) => process.exit(code), (error) => { process.stderr.write(`${error.stack || error}\n`); process.exit(1); });
}
