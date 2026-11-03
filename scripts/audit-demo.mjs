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
import { parseReviewerList } from './reviewer-registry.mjs';
import { runHostReview } from './review-host.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
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

function runDockerDemo({ out, surface, env }) {
  const result = spawnSync('bash', [
    path.join(HERE, 'orchestrate.sh'), '--target', DEMO_FIXTURE, '--out', out, '--name', 'demo-fixture',
    '--surface', surface, '--reviewers', DEMO_REVIEWERS.join(','), '--orchestrator', 'scripted:judge',
    '--assign', 'matrix', '--passes', String(DEMO_BUDGETS.passes), '--tool-budget', String(DEMO_BUDGETS.toolBudget),
  ], { stdio: 'inherit', env });
  return result.status === 0 ? 0 : result.status || 1;
}

async function runHostDemo({ out, surface, env }) {
  process.stdout.write(`${DEMO_STAMP}\nHost snapshot of ${DEMO_FIXTURE}\n`);
  await runHostReview({ target: DEMO_FIXTURE, out, surface, reviewers: parseReviewerList([...DEMO_REVIEWERS]), assign: 'matrix', budgets: { ...DEMO_BUDGETS }, preset: 'demo' }, env);
  const html = spawnSync(process.execPath, [path.join(HERE, 'generate-html-report.mjs'), out], { encoding: 'utf8' });
  const report = path.join(out, 'report.html');
  // Exit 2 is the renderer's "rendered, but INCOMPLETE" (a host demo has no cross-check or test catalog).
  if (![0, 2].includes(html.status) || !fs.existsSync(report) || !fs.readFileSync(report, 'utf8').includes(DEMO_STAMP)) {
    throw new Error(`demo report was not rendered with the ${DEMO_STAMP} banner: ${(html.stderr || '').slice(0, 400)}`);
  }
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
  const demoEnv = { ...env, OMNI_DEMO: '1' };
  if (!argv.includes('--no-docker') && env.OMNI_DEMO_HOST !== '1' && dockerReady()) return runDockerDemo({ out, surface, env: demoEnv });
  try { await runHostDemo({ out, surface, env: demoEnv }); }
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
