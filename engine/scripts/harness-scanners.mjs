// Dependency advisories and official scanners (cargo-audit, npm audit, gitleaks, semgrep, osv-scanner) plus the
// dependency-resolvability reports. Every result is recorded as a structured row for harness/scanner-results.json.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scannerEvidence } from './scanner-evidence.mjs';
import { analyseNodeDeps, analysePythonDeps } from './stack-detect.mjs';
import { walk, rel } from './harness-walk.mjs';

const MAX_LOCKS = 4;
export const scannerChecks = [];
let scannerOutputDir;
export function setScannerOutputDir(dir) {
  scannerOutputDir = dir;
  scannerChecks.length = 0;
}
export const missingScanner = (tool, detail, state = 'blocked') => scannerChecks.push({ tool, state, detail });
function recordScanner(tool, result, scope = '.') {
  const evidenceFile = `scanner-output-${tool}-${scannerChecks.length}.json`;
  fs.writeFileSync(path.join(scannerOutputDir, evidenceFile), JSON.stringify(result));
  const version = spawnSync(tool === 'npm-audit' ? 'npm' : tool, [tool === 'gitleaks' ? 'version' : '--version'], { encoding: 'utf8', timeout: 5000 });
  let reportedVersion = (version.stdout || version.stderr || '').trim().slice(0, 200);
  if (tool === 'semgrep') { try { reportedVersion = JSON.parse(result.stdout).version || reportedVersion; } catch { /* invalid output remains a failed scan */ } }
  const row = { ...scannerEvidence(tool, result), version: reportedVersion, scope, evidenceFile: `harness/${evidenceFile}` };
  scannerChecks.push(row);
  return row.state !== 'failed';
}

function runCmd(bin, args, cwd, timeoutMs, env) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(bin, args, { cwd, env, timeout: timeoutMs, killSignal: 'SIGKILL' });
    } catch (err) {
      resolve({ code: 127, stdout: '', stderr: String(err) });
      return;
    }
    child.stdout?.on('data', (b) => { if (stdout.length < 32 * 1024 * 1024) stdout += b; });
    child.stderr?.on('data', (b) => { if (stderr.length < 1024 * 1024) stderr += b; });
    child.on('error', (err) => resolve({ code: 127, stdout, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function findLocks(root, name) {
  const out = [];
  walk(root, (file) => {
    if (path.basename(file) === name && out.length < MAX_LOCKS) out.push(file);
  });
  return out;
}

function createSerialLane() {
  let tail = Promise.resolve();
  return (fn) => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => {});
    return next;
  };
}

async function prepareDepScan(root, runOsv = (fn) => fn()) {
  const cargo = findLocks(root, 'Cargo.lock');
  const npm = findLocks(root, 'package-lock.json');
  const other = [];
  for (const name of ['pnpm-lock.yaml', 'yarn.lock', 'go.sum']) {
    if (findLocks(root, name).length) other.push(name);
  }
  const cargoHome = process.env.CARGO_HOME || path.join(process.env.HOME || '', '.cargo');
  const hasAdvisoryDb = fs.existsSync('/opt/audit-scanners/advisory-db')
    || fs.existsSync(path.join(cargoHome, 'advisory-db'))
    || fs.existsSync(path.join(process.env.HOME || '', '.cargo/advisory-db'));
  const dbArgs = fs.existsSync('/opt/audit-scanners/advisory-db') ? ['--db', '/opt/audit-scanners/advisory-db'] : [];

  const cargoPromise = (cargo.length && hasAdvisoryDb)
    ? Promise.all(cargo.map((lock) => runCmd(
      'cargo-audit',
      ['audit', '--file', lock, '--no-fetch', '--format', 'json', ...dbArgs],
      '/tmp',
      60_000,
      cleanEnv(),
    )))
    : Promise.resolve([]);

  const npmPromise = npm.length
    ? (async () => {
      // npm refuses to load one file as both user and global config, so each gets its own empty file.
      const npmConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-npm-config-'));
      for (const name of ['user', 'global']) fs.writeFileSync(path.join(npmConfig, name), '', { mode: 0o600 });
      try {
        return await Promise.all(npm.map((lock) => runCmd('npm', [
          'audit', '--package-lock-only', '--json', '--registry', 'https://registry.npmjs.org',
          '--userconfig', path.join(npmConfig, 'user'), '--globalconfig', path.join(npmConfig, 'global'),
        ], path.dirname(lock), 60_000, cleanEnv({ npm_config_ignore_scripts: 'true' }))));
      } finally {
        fs.rmSync(npmConfig, { recursive: true, force: true });
      }
    })()
    : Promise.resolve([]);

  const py = analysePythonDeps(root);
  const resolved = process.env.OMNI_RESOLVED_PYTHON_REQS || '/work/resolved/requirements.txt';
  const runPyResolved = Boolean(py.applicable && py.unresolved && fs.existsSync(resolved) && which('osv-scanner'));
  const pyResolvedPromise = runPyResolved
    ? runOsv(() => runCmd('osv-scanner', ['scan', 'source', '--no-resolve', '--offline-vulnerabilities', '--format', 'json', '-L', `requirements.txt:${resolved}`], '/tmp', 120_000, cleanEnv()))
    : Promise.resolve(null);

  const [cargoResults, npmResults, pyResolvedResult] = await Promise.all([
    cargoPromise,
    npmPromise,
    pyResolvedPromise,
  ]);

  return () => {
    const lines = ['# Dependency leads', '', 'Advisories only. A vulnerable crate is a finding when the program or the server can reach it.', ''];
    if (!cargo.length) {
      lines.push('cargo-audit: no Cargo.lock');
      missingScanner('cargo-audit', 'No Cargo.lock', 'not_applicable');
    } else if (!hasAdvisoryDb) {
      missingScanner('cargo-audit', 'RustSec database unavailable');
      lines.push('cargo-audit: RustSec DB not cached at ~/.cargo/advisory-db (no fetch on an untrusted tree). Run `cargo audit` once in a trusted repo, then re-run.');
    } else {
      for (let i = 0; i < cargo.length; i++) {
        const lock = cargo[i];
        const r = cargoResults[i];
        lines.push(`## cargo-audit ${rel(root, lock)} (exit ${r.code})`);
        lines.push(recordScanner('cargo-audit', r, rel(root, lock)) ? summariseCargo(r.stdout, r.stderr) : 'FAILED: scanner did not produce a valid advisory result.');
        lines.push('');
      }
    }
    if (!npm.length) {
      lines.push('npm audit: no package-lock.json');
      missingScanner('npm-audit', 'No package-lock.json', 'not_applicable');
    } else {
      for (let i = 0; i < npm.length; i++) {
        const lock = npm[i];
        const r = npmResults[i];
        lines.push(`## npm audit ${rel(root, lock)} (exit ${r.code})`);
        lines.push(recordScanner('npm-audit', r, rel(root, lock)) ? summariseNpm(r.stdout, r.stderr) : 'FAILED: scanner did not produce a valid advisory result.');
        lines.push('');
      }
    }
    reportNode(root, lines);
    reportPythonSync(py, pyResolvedResult, lines);
    if (other.length) lines.push(`Lockfiles with no dedicated scanner in this harness: ${other.join(', ')}. osv-scanner covers these when it is on PATH (see tools.md).`);
    lines.push('This lead scan does not build, install, or send traffic. The disposable sandbox writes sandbox.md. A row there marked impossible was not covered.');
    return lines.join('\n') + '\n';
  };
}

export async function depScan(root) {
  const commit = await prepareDepScan(root);
  return commit();
}

function reportNode(root, lines) {
  const nd = analyseNodeDeps(root);
  if (!nd.applicable) { lines.push('node-deps: no package.json'); missingScanner('node-deps', 'No package.json', 'not_applicable'); return; }
  lines.push('## node dependency resolvability');
  lines.push(`package.json files: ${nd.manifests.length}. Without a lockfile: ${nd.noLock.join(', ') || 'none'}.`);
  for (const row of nd.nonRegistry.slice(0, 20)) lines.push(`- non-registry source ${row}`);
  for (const row of nd.loose.slice(0, 20)) lines.push(`- open range ${row}`);
  for (const row of nd.lifecycle.slice(0, 20)) lines.push(`- lifecycle script ${row} (runs on install unless --ignore-scripts)`);
  if (nd.unresolved) {
    lines.push(`Coverage gap: ${nd.noLock.length} package.json without lockfile, ${nd.nonRegistry.length} non-registry source(s), ${nd.loose.length} open range(s). Advisory scans need exact locked versions.`);
    missingScanner('node-deps', `${nd.noLock.length} package.json without lockfile, ${nd.nonRegistry.length} non-registry source(s), ${nd.loose.length} open range(s): advisory coverage is partial`);
  } else {
    recordScanner('node-deps', { code: 0, stdout: JSON.stringify({ nodeDeps: { unresolved: 0, manifests: nd.manifests.length } }), stderr: '' });
    lines.push('Every dependency-bearing package.json is covered by a lockfile with registry sources.');
  }
  lines.push('');
}

function reportPythonSync(py, pyResolvedResult, lines) {
  if (!py.applicable) { lines.push('python-deps: no Python dependency manifest'); missingScanner('python-deps', 'No Python dependency manifest', 'not_applicable'); return; }
  lines.push('## python dependency resolvability');
  lines.push(`Requirement files: ${py.requirements.join(', ') || 'none'}. Lockfiles: ${py.lockfiles.join(', ') || 'none'}. pyproject without lockfile: ${py.unlockedProjects.join(', ') || 'none'}.`);
  for (const row of [...py.unpinned.slice(0, 20)]) lines.push(`- unpinned ${row}`);
  for (const row of py.risky.slice(0, 20)) lines.push(`- non-index or editable source ${row}`);
  // The sandbox resolves loose requirements to exact wheels (uv pip compile) before reviewers start; scanning that set closes the gap as of resolution time.
  let resolvedScan = false;
  if (pyResolvedResult) {
    resolvedScan = recordScanner('osv-scanner', pyResolvedResult, 'resolved python requirements (/work/resolved/requirements.txt)');
    lines.push(`Resolved set scan (exit ${pyResolvedResult.code}): ${resolvedScan ? summariseOsv(pyResolvedResult.stdout) : 'FAILED: scanner did not produce a valid advisory result.'}`);
  }
  if (py.unresolved && resolvedScan) {
    recordScanner('python-deps', { code: 0, stdout: JSON.stringify({ pythonDeps: { unresolved: py.unresolved, resolvedScan: true, requirements: py.requirements } }), stderr: '' });
    lines.push(`${py.unpinned.length} loose requirement(s) were resolved to exact versions at review time and scanned; the repository itself is still not reproducible (pin or lock them).`);
  } else if (py.unresolved) {
    lines.push(`Coverage gap: ${py.unpinned.length} unpinned requirement(s), ${py.risky.length} non-index source(s). Advisory scans (osv-scanner --no-resolve) only see exact versions; builds are not reproducible.`);
    missingScanner('python-deps', `${py.unpinned.length} unpinned requirement(s), ${py.risky.length} non-index source(s), ${py.unlockedProjects.length} pyproject without lockfile: advisory coverage is partial`);
  } else {
    recordScanner('python-deps', { code: 0, stdout: JSON.stringify({ pythonDeps: { unresolved: 0, requirements: py.requirements, lockfiles: py.lockfiles } }), stderr: '' });
    lines.push('All Python requirements are exact-pinned or locked; osv-scanner covers them.');
  }
  lines.push('');
}

function cleanEnv(extra = {}) {
  const keep = [
    'PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'CARGO_HOME', 'XDG_CACHE_HOME',
    'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY',
  ];
  const env = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return { ...env, ...extra };
}

function summariseCargo(stdout, stderr) {
  try {
    const json = JSON.parse(stdout);
    const vulns = json.vulnerabilities?.list || json.vulnerabilities || [];
    const list = Array.isArray(vulns) ? vulns : [];
    if (!list.length) return 'no vulnerability in the cached RustSec DB. Warnings may still be in the raw JSON.';
    return list.slice(0, 30).map((v) => {
      const id = v.advisory?.id || v.id || 'advisory';
      const name = v.package?.name || v.package_name || '';
      return `- ${id} ${name}`.trim();
    }).join('\n');
  } catch {
    const tail = (stderr || stdout || 'no output').split('\n').slice(0, 8).join('\n');
    return `unparsed output:\n${tail}`;
  }
}

function summariseNpm(stdout, stderr) {
  try {
    const json = JSON.parse(stdout);
    const via = json.vulnerabilities || {};
    const names = Object.keys(via);
    if (!names.length) return 'no advisory at moderate or above, or the audit payload listed none.';
    return names.slice(0, 30).map((n) => `- ${n} ${via[n].severity || ''}`.trim()).join('\n');
  } catch {
    const tail = (stderr || stdout || 'no output').split('\n').slice(0, 8).join('\n');
    return `unparsed output:\n${tail}`;
  }
}

function which(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}
function summariseGitleaks(stdout) {
  try {
    const rows = JSON.parse(stdout);
    if (!Array.isArray(rows) || !rows.length) return 'no leak under the default rules.';
    return rows.slice(0, 30).map((row) => `- ${row.RuleID || 'rule'} ${row.File || ''}:${row.StartLine || '?'}`).join('\n');
  } catch {
    return 'unparsed output. Secrets are not copied into this file.';
  }
}

function summariseSemgrep(stdout, root) {
  try {
    const json = JSON.parse(stdout);
    const rows = json.results || [];
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    const warned = [...new Set((json.errors || []).map((error) => error.path || '').filter(Boolean))];
    const partial = warned.length ? `Partial parse in ${warned.length} file(s); unparsed spans were not analysed: ${warned.slice(0, 10).map((file) => file.startsWith(prefix) ? file.slice(prefix.length) : file).join(', ')}\n` : '';
    if (!rows.length) return `${partial}no result from the pinned upstream OWASP rule bundle.`;
    return partial + rows.slice(0, 40).map((row) => {
      const file = (row.path || '').startsWith(prefix) ? row.path.slice(prefix.length) : (row.path || '');
      const line = row.start?.line || '?';
      return `- ${row.check_id || 'rule'} ${file}:${line}`;
    }).join('\n');
  } catch {
    return 'unparsed output.';
  }
}

function summariseOsv(stdout) {
  try {
    const json = JSON.parse(stdout);
    const results = json.results || [];
    const lines = [];
    for (const result of results) {
      for (const pkg of result.packages || []) {
        const name = pkg.package?.name || '';
        for (const vuln of pkg.vulnerabilities || []) {
          if (lines.length < 30) lines.push(`- ${vuln.id || 'advisory'} ${name}`.trim());
        }
      }
    }
    return lines.length ? lines.join('\n') : 'no advisory.';
  } catch {
    return 'unparsed output.';
  }
}

async function gitleaksConfig() {
  if (fs.existsSync('/opt/audit-scanners/gitleaks.toml')) return '/opt/audit-scanners/gitleaks.toml';
  const ver = (spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).stdout || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(ver)) return '';
  const dir = path.join(process.env.HOME || '/tmp', '.cache', 'omniswarm-audit');
  const file = path.join(dir, `gitleaks-${ver}.toml`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  fs.mkdirSync(dir, { recursive: true });
  const url = `https://raw.githubusercontent.com/gitleaks/gitleaks/v${ver}/config/gitleaks.toml`;
  const r = await runCmd('curl', ['-fsSL', '--max-time', '30', '-o', file, url], '/tmp', 40_000, cleanEnv());
  if (r.code !== 0 || !fs.existsSync(file) || fs.statSync(file).size < 1000) {
    try { fs.rmSync(file); } catch { /* keep going without a pinned config */ }
    return '';
  }
  return file;
}

async function prepareWriteTools(root, outDir, runOsv = (fn) => fn()) {
  const report = path.join(outDir, 'gitleaks.json');
  const hasGitleaks = Boolean(which('gitleaks'));
  const hasSemgrep = Boolean(which('semgrep'));
  const hasOsv = Boolean(which('osv-scanner'));

  const gitleaksPromise = hasGitleaks
    ? (async () => {
      const config = await gitleaksConfig();
      if (!config) return { config: '', result: null, raw: '' };
      const args = ['detect', '--source', root, '--no-git', '--redact=100', '--no-banner', '--ignore-gitleaks-allow', '--report-format', 'json', '--report-path', report, '--exit-code', '0', '--config', config];
      const r = await runCmd('gitleaks', args, '/tmp', 120_000, cleanEnv());
      const raw = fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : r.stdout;
      return { config, result: r, raw };
    })()
    : Promise.resolve(null);

  const semgrepPromise = hasSemgrep
    ? runCmd('semgrep', [
      'scan', '--metrics=off', '--disable-version-check', '--json', '--timeout=30',
      '--config=/opt/audit-scanners/semgrep-rules', '--disable-nosem', '--no-git-ignore',
      '--exclude=node_modules', '--exclude=target', '--exclude=dist', '--exclude=harness-fixtures',
      root,
    ], '/tmp', 180_000, cleanEnv({ SEMGREP_SEND_METRICS: 'off' }))
    : Promise.resolve(null);

  const osvPromise = hasOsv
    ? runOsv(() => runCmd('osv-scanner', [
      'scan', 'source', '--recursive', '--no-resolve', '--allow-no-lockfiles', '--offline-vulnerabilities', '--format', 'json', root,
    ], '/tmp', 120_000, cleanEnv()))
    : Promise.resolve(null);

  const [gitleaksOut, semgrepRes, osvRes] = await Promise.all([
    gitleaksPromise,
    semgrepPromise,
    osvPromise,
  ]);

  return () => {
    const lines = [
      '# Scanner leads',
      '',
      'Official tools only, and never the target\'s own rules or allowlist. A hit is a lead. A missing tool is not a clean result.',
      '',
    ];
    if (!hasGitleaks) {
      lines.push('gitleaks: not on PATH. Secret scan fell back to the regex in web.md.');
      missingScanner('gitleaks', 'Executable unavailable');
    } else if (!gitleaksOut.config) {
      missingScanner('gitleaks', 'Trusted rules unavailable');
      lines.push('gitleaks: not started — trusted upstream rules unavailable. Target configuration is not a fallback.');
    } else {
      const { config, result: r, raw } = gitleaksOut;
      lines.push(`## gitleaks (exit ${r.code})`);
      lines.push(`Rules: upstream gitleaks default for the installed version (${path.basename(config)}). A .gitleaks.toml in the tree is not used.`);
      lines.push(recordScanner('gitleaks', { ...r, stdout: raw }) ? summariseGitleaks(raw) : 'FAILED: scanner did not produce a valid secret scan result.');
      lines.push('');
    }
    if (!hasSemgrep) {
      lines.push('semgrep: not on PATH. SAST fell back to the regex in web.md.');
      missingScanner('semgrep', 'Executable unavailable');
    } else {
      lines.push(`## semgrep pinned upstream OWASP and Solidity security rules (exit ${semgrepRes.code})`);
      lines.push(recordScanner('semgrep', semgrepRes) ? summariseSemgrep(semgrepRes.stdout, root) : 'FAILED: scanner did not produce a complete SAST result.');
      lines.push('');
    }
    if (!hasOsv) {
      lines.push('osv-scanner: not on PATH.');
      missingScanner('osv-scanner', 'Executable unavailable');
    } else {
      lines.push(`## osv-scanner (exit ${osvRes.code})`);
      lines.push('Lockfiles only (`--no-resolve`). Call analysis is off in this lead scan. The sandbox runs it when a Cargo.lock is present; see sandbox.md.');
      lines.push(recordScanner('osv-scanner', osvRes) ? summariseOsv(osvRes.stdout) : 'FAILED: scanner did not produce a valid advisory result.');
      lines.push('');
    }
    return lines.join('\n') + '\n';
  };
}

export async function writeTools(root, outDir) {
  const commit = await prepareWriteTools(root, outDir);
  return commit();
}

export async function runAllScanners(root, outDir) {
  const runOsv = createSerialLane();
  const [commitDeps, commitTools] = await Promise.all([
    prepareDepScan(root, runOsv),
    prepareWriteTools(root, outDir, runOsv),
  ]);
  return { deps: commitDeps(), tools: commitTools() };
}
