#!/usr/bin/env node
// ./bin/audit demo — scripted reviewers on the bundled fixture only.
// Docker present: the normal sandbox (the orchestrator stamps any review of the fixture as the demo).
// Docker absent (or --no-docker): the host runner serves the fixture read-only. Either way every report
// is marked DEMO — not a review, and both paths use the same reviewers, assignment and budgets.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDockerBin } from './docker-mcp-bridge.mjs';
import { parseReviewerList, parseReviewerSpec } from './reviewer-registry.mjs';
import { runHostReview } from './review-host.mjs';
import { runOfflineDebate } from './debate-run.mjs';
import { selectSurfaces } from './reviewer-plan.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';
import { DEMO_LIMITED_STAMP, demoReportVerdict } from './audit-demo-verdict.mjs';
import { REPORTS_ROOT } from './report-util-files.mjs';
import { readReportJson, writeReportFile } from './report-files.mjs';
import { runStageAdvice } from './orchestrator-advice.mjs';
import { saveDebateState, storeStage1Evidence, writeStage1Artifacts } from './orchestrator-pipeline.mjs';
import { finalizePipelineArtifacts } from './debate-step-cli.mjs';
import { renderReport } from './generate-html-report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEMO_REVIEWERS = Object.freeze(['scripted:baseline', 'scripted:paranoid', 'scripted:lazy', 'scripted:wrong']);
export const DEMO_BUDGETS = Object.freeze({ passes: 1, toolBudget: 10, maxCostUsd: null });
export const DEMO_STAMP = 'DEMO — not a review';

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function dockerReady() {
  const result = spawnSync(resolveDockerBin(), ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 8000 });
  return result.status === 0;
}

function rejectForeignTarget(argv) {
  if (!argv.some((arg) => ['--repo', '--path', '-r', '--github', '--gh', '-g'].includes(arg))) return false;
  process.stderr.write('demo runs only the bundled fixture\n');
  return true;
}

function resolveDemoPipeline(argv) {
  const hasNoDebate = argv.includes('--no-debate');
  const hasStep = argv.includes('--step-by-step');
  const explicit = flag(argv, '--pipeline');
  if ((hasNoDebate && hasStep) || (explicit && (hasNoDebate || hasStep))) {
    throw new Error('demo: conflicting pipeline flags (--pipeline, --step-by-step, --no-debate)');
  }
  if (hasNoDebate) return 'stage-1';
  if (hasStep) return 'step-by-step';
  const mode = explicit || 'full';
  if (!['full', 'step-by-step', 'stage-1'].includes(mode)) {
    throw new Error(`demo: invalid --pipeline ${mode} (expected full, step-by-step, or stage-1)`);
  }
  return mode;
}

function resolveDemoConcurrency(argv) {
  const raw = flag(argv, '--concurrency');
  if (raw === undefined) return 3;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 8) {
    throw new Error(`demo: --concurrency must be an integer between 1 and 8 (got ${raw})`);
  }
  return n;
}

function runDockerDemo({ out, surface, pipelineMode, concurrency, env }) {
  const result = spawnSync('bash', [
    path.join(HERE, 'orchestrate.sh'), '--target', DEMO_FIXTURE, '--out', out, '--name', 'demo-fixture',
    '--surface', surface, '--reviewers', DEMO_REVIEWERS.join(','), '--orchestrator', 'scripted:judge',
    '--assign', 'matrix', '--passes', String(DEMO_BUDGETS.passes), '--tool-budget', String(DEMO_BUDGETS.toolBudget),
    '--pipeline', pipelineMode, '--concurrency', String(concurrency),
  ], { stdio: 'inherit', env });
  if (result.status !== 2) return result.status === 0 ? 0 : result.status || 1;
  // Exit 2 is an INCOMPLETE report. The bundled NEAR fixture keeps one coverage gap by design (see audit-demo-verdict.mjs).
  const verdict = demoReportVerdict(out, DEMO_FIXTURE);
  if (verdict.code !== 0) {
    process.stderr.write(`demo: ${verdict.reason}\n`);
    return verdict.code;
  }
  process.stdout.write(`${DEMO_LIMITED_STAMP}. The report stays INCOMPLETE VERIFICATION only for:\n${verdict.limited.map((gap) => `  - ${gap}`).join('\n')}\n`);
  process.stdout.write(`Demo report saved to: ${out}\n`);
  return 0;
}

async function runHostDemo({ out, surface, pipelineMode, concurrency, env }) {
  process.stdout.write(`${DEMO_STAMP}\nHost snapshot of ${DEMO_FIXTURE}\n`);
  await runHostReview({
    target: DEMO_FIXTURE, out, surface, reviewers: parseReviewerList([...DEMO_REVIEWERS]),
    orchestrator: 'scripted:judge', assign: 'matrix', pipelineMode, concurrency,
    budgets: { ...DEMO_BUDGETS }, preset: 'demo',
  }, env);
  const baseMeta = readReportJson(out, 'meta.json');
  const stage1Meta = { ...baseMeta, stage1DefersDebates: true };
  writeReportFile(out, 'meta.json', `${JSON.stringify(stage1Meta, null, 2)}\n`);
  const stage1Health = await renderReport(out);
  const evidence = storeStage1Evidence(out, DEMO_FIXTURE);
  let advice = null;
  if (pipelineMode === 'step-by-step' || pipelineMode === 'full') {
    advice = await runStageAdvice({ out, target: DEMO_FIXTURE, orchestrator: parseReviewerSpec('scripted:judge'), execute: null, meta: stage1Meta, health: stage1Health });
  }
  const stage1Findings = readReportJson(out, 'findings-and-scores.json');
  writeStage1Artifacts({ out, meta: stage1Meta, findings: stage1Findings, health: stage1Health, advice, evidence });
  writeReportFile(out, 'meta.json', `${JSON.stringify(baseMeta, null, 2)}\n`);

  if (pipelineMode === 'full') {
    // The same debate, scripted judge and general review the Docker demo runs, over the committed submissions.
    const debate = await runOfflineDebate(out, DEMO_FIXTURE, { scope: selectSurfaces(surface).map((s) => s.code), concurrency });
    if (debate.missing.length) throw new Error(`demo debate left ${debate.missing.length} turn(s) without an answer`);
    saveDebateState(out, debate, 2);
    writeReportFile(out, 'meta.json', `${JSON.stringify({ ...baseMeta, debatesCompleted: true }, null, 2)}\n`);
  }
  await finalizePipelineArtifacts(out, { target: DEMO_FIXTURE, pipelineMode });
  const report = path.join(out, 'report.html');
  // A host demo has no cross-check or test catalog, so report.html renders with the DEMO_STAMP banner.
  if (!fs.existsSync(report) || !fs.readFileSync(report, 'utf8').includes(DEMO_STAMP)) {
    throw new Error(`demo report was not rendered with the ${DEMO_STAMP} banner`);
  }
}

export async function runDemo(argv = process.argv.slice(2), env = process.env) {
  if (rejectForeignTarget(argv)) return 2;
  const surface = flag(argv, '--surface') || 'all';
  let pipelineMode;
  let concurrency;
  try {
    pipelineMode = resolveDemoPipeline(argv);
    concurrency = resolveDemoConcurrency(argv);
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    return 2;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const out = path.resolve(flag(argv, '--out') || path.join(REPORTS_ROOT, `${stamp}-demo-fixture`));
  if (fs.existsSync(out) && fs.readdirSync(out).length) {
    process.stderr.write('demo: output directory must be empty\n');
    return 2;
  }
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const demoEnv = { ...env, OMNI_DEMO: '1' };
  if (!argv.includes('--no-docker') && env.OMNI_DEMO_HOST !== '1' && dockerReady()) return runDockerDemo({ out, surface, pipelineMode, concurrency, env: demoEnv });
  try { await runHostDemo({ out, surface, pipelineMode, concurrency, env: demoEnv }); }
  catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    return 1;
  }
  process.stdout.write(`Demo report saved to: ${out}\n`);
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  runDemo().then((code) => process.exit(code), (error) => { process.stderr.write(`${error.stack || error}\n`); process.exit(1); });
}
