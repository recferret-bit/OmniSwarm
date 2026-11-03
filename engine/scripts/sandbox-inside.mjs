// Runs inside the disposable container. Writes /out/results.json as it goes.
// Host-owned rows (solana-verify, and ZAP once a server is listening) stay pending.
// The checks live in sandbox-inside-*.mjs; sandbox.sh mounts every one of them flat under /opt/audit.
import fs from 'node:fs';
import path from 'node:path';
import { assess, plan } from './sandbox-lib.mjs';
import { anchorBuild, cargoLocked, scripts } from './sandbox-inside-builds.mjs';
import { CARGO_ENV, brief, log, run, sweepSpills } from './sandbox-inside-exec.mjs';
import { npmFetch, npmInstall, pnpmInstall, yarnInstall } from './sandbox-inside-node.mjs';
import { audits, cargoAudit, maybeServe, osv } from './sandbox-inside-scans.mjs';
import { outDir, publish, put, save, timeLeft } from './sandbox-inside-state.mjs';

const reviewOnly = process.env.SANDBOX_REVIEW_ONLY === '1';
const fast = process.env.SANDBOX_FAST === '1';

// A Python project (dependency manifest in the directory or an ancestor) that has pytest-style tests.
function hasPythonTests(root) {
  let tests = false, projects = false;
  (function walk(dir, depth) {
    if (depth > 6 || tests && projects) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (ent.isSymbolicLink() || ['.git', 'node_modules', 'target', 'dist', '.venv', 'venv'].includes(ent.name)) continue;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), depth + 1);
      else if (/^(?:conftest|test_.*|.*_test)\.py$/.test(ent.name)) tests = true;
      else if (/^(?:requirements[\w.-]*\.txt|pyproject\.toml)$/.test(ent.name)) projects = true;
    }
  })(root, 0);
  return tests && projects;
}

// The snapshot is sealed read-only and cpSync keeps those modes; suites that write to their own tree (drafts, caches) fail on them.
function copySource() {
  fs.mkdirSync('/work/src', { recursive: true });
  fs.cpSync('/src', '/work/src', { recursive: true, force: true });
  const writable = (dir) => {
    fs.chmodSync(dir, fs.lstatSync(dir).mode | 0o200);
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) writable(p);
      else if (ent.isFile()) fs.chmodSync(p, fs.lstatSync(p).mode | 0o200);
    }
  };
  writable('/work/src');
}

// Review mode: only the trusted manifest/lockfile preparers have network access. They cannot run target code.
async function prepareDependencies(tree) {
  if (reviewOnly && tree.cargoLocks.items.length && !fast) {
    const prepared = await run('python3', ['/opt/prepare-cargo-cache.py'], { cwd: '/tmp', timeoutMs: 12 * 60 * 1000 });
    log('cargo-cache', prepared);
    put('cargo-cache', prepared.code === 0 ? 'ran' : 'failed', `Manifest-only locked dependency preparation: ${brief(prepared)}`);
  }
  if (reviewOnly && !fast && hasPythonTests('/work/src')) {
    // Wheel-only install from requirements files; no target code or build backend runs while networked.
    const prepared = await run('python3', ['/opt/prepare-python-env.py'], { cwd: '/tmp', timeoutMs: 25 * 60 * 1000 });
    log('python-env', prepared);
    put('python-env', prepared.code === 0 ? 'ran' : 'failed', `Wheel-only Python test environment: ${brief(prepared)}`);
  }
}

// Full sandbox only: every pending check this tree asked for, in a fixed order, inside the time budget.
async function runOwnedChecks(tree, want) {
  const owned = [
    ['cargo-build', () => cargoLocked('cargo-build', ['build', '--locked'], tree.cargoLocks.items)],
    ['cargo-test', () => cargoLocked('cargo-test', ['test', '--locked'], tree.cargoLocks.items)],
    ['build-sh', () => scripts('build-sh', tree.buildScripts.items)],
    ['test-sh', () => scripts('test-sh', tree.testScripts.items)],
    ['anchor-build', () => anchorBuild(tree)],
    ['npm-install', () => npmInstall(tree.npmLocks.items)],
    ['pnpm-install', () => pnpmInstall(tree.pnpmLocks.items)],
    ['yarn-install', () => yarnInstall(tree.yarnOnly.items)],
    ['npm-audit', () => audits(tree)],
    ['cargo-audit', () => cargoAudit(tree.cargoLocks.items)],
    ['osv-lock', () => osv(false)],
    ['osv-call', () => osv(true)],
  ];
  for (const [id, fn] of owned) {
    if (!want.has(id)) continue;
    if (timeLeft() < 20_000) {
      put(id, 'impossible', 'Sandbox time limit reached before this check.');
      continue;
    }
    try { await fn(); } catch (err) { put(id, 'failed', err.message || String(err)); }
  }
  if (want.has('zap')) {
    try { await maybeServe(tree); } catch (err) { put('zap', 'failed', err.message || String(err)); }
  }
}

// The read-only lead scan. In review mode its structured scanner evidence becomes the static-scan rows.
async function runHarness() {
  if (!fs.existsSync('/opt/audit/harness.mjs')) return;
  const hArgs = ['/opt/audit/harness.mjs', '--target', '/work/src', '--out', path.join(outDir, 'harness-leads')];
  if (fast) hArgs.push('--no-deps');
  const hRes = await run('node', hArgs, { cwd: '/work/src', timeoutMs: Math.min(240_000, Math.max(15_000, timeLeft())), env: CARGO_ENV });
  log('harness', hRes);
  if (!reviewOnly) return;
  try {
    const record = JSON.parse(fs.readFileSync(path.join(outDir, 'harness-leads/scanner-results.json'), 'utf8'));
    for (const [tool, id] of [['cargo-audit', 'cargo-audit'], ['osv-scanner', 'osv-lock'], ['semgrep', 'semgrep'], ['gitleaks', 'gitleaks']]) {
      const rows = record.checks.filter(row => row.tool === tool);
      const ran = rows.length && rows.every(row => ['passed', 'findings'].includes(row.state));
      put(id, ran ? 'ran' : rows.some(row => row.state === 'failed') ? 'failed' : 'impossible', `${tool}: ${rows.map(row => row.state).join(', ') || 'no scanner evidence'}. See scanner-results.json and scanner-output files. Static scan only; target code was not executed.`);
    }
  } catch { put('static-scanners', 'failed', 'Structured scanner evidence was not produced. See harness.log.'); }
}

async function holdForReviewers() {
  fs.mkdirSync(path.join(outDir, 'auditors'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'crosscheck'), { recursive: true });
  // The preparation budget ends at checks.done; reviewers have no deadline. The host ends this container with
  // docker kill. No file under /out can release it: target suites run as the same uid and can write there.
  for (;;) await new Promise((r) => setTimeout(r, 60_000));
}

async function main() {
  try {
    copySource();
    if (reviewOnly) {
      process.env.CARGO_TARGET_DIR = '/work/target';
      process.env.CARGO_HOME = '/work/cargo';
      process.env.CARGO_NET_OFFLINE = 'true';
    }
    const tree = plan('/work/src');
    await prepareDependencies(tree);
    for (const row of assess(tree)) {
      if (row.result === 'impossible') put(row.id, 'impossible', row.detail);
    }
    const want = new Set(assess(tree).filter((row) => row.result === 'pending').map((row) => row.id));
    const fetchNode = reviewOnly && !fast && tree.npmLocks.items.length > 0;
    if (fetchNode) want.delete('npm-install');
    if (reviewOnly) {
      for (const id of want) put(id, 'impossible', 'Source security review: target builds, install hooks, active scans and tests are disabled during networked preparation. Existing tests may run through the fixed MCP catalog after network disconnection.');
    } else if (!fast) {
      await runOwnedChecks(tree, want);
    } else {
      for (const id of want) put(id, 'impossible', 'Skipped in fast mode (SANDBOX_FAST=1).');
    }
    await runHarness();
    // After the scanners, so gitleaks, semgrep and osv-scanner never see node_modules.
    if (fetchNode) {
      try { await npmFetch(tree.npmLocks.items); } catch (err) { put('npm-install', 'failed', err.message || String(err)); }
    }
    save();
    publish('checks.done', { ready: true, timestamp: new Date().toISOString() });
    if (process.env.SANDBOX_HOLD === '1') await holdForReviewers();
  } finally {
    sweepSpills();
  }
}

main().catch((err) => {
  put('cargo-build', 'failed', err.message || String(err));
  process.exit(0);
});
