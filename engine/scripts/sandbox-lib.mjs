// Plan, copy, and summary for the disposable audit sandbox, and the CLI that sandbox.sh calls (`node sandbox-lib.mjs <cmd>`).
// The target is untrusted. This module only reads a tree and writes a report. The tree walk and plan live in
// sandbox-tree.mjs, the egress allow-lists in sandbox-net.mjs, built-artifact export and the --rpc comparison in
// sandbox-artifacts.mjs; they are re-exported here so callers keep one entry point.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rpcAllowed } from './sandbox-net.mjs';
import { safeRel, readJson, copyTree, plan } from './sandbox-tree.mjs';
import { exportArtifacts, compareDeployed } from './sandbox-artifacts.mjs';

export { rpcAllowed, hostAllowed, ipAllowed } from './sandbox-net.mjs';
export { safeRel, copyTree, plan } from './sandbox-tree.mjs';
export { programIds, exportArtifacts, compareDeployed } from './sandbox-artifacts.mjs';

export const CHECKS = [
  ['cargo-build', 'cargo build (dependency build.rs)'],
  ['build-sh', 'project build.sh'],
  ['cargo-test', 'cargo test'],
  ['test-sh', 'project test.sh'],
  ['anchor-build', 'anchor build (Anchor CLI and platform-tools)'],
  ['npm-install', 'npm install'],
  ['pnpm-install', 'pnpm install'],
  ['yarn-install', 'yarn install'],
  ['npm-audit', 'npm audit'],
  ['cargo-audit', 'cargo audit'],
  ['osv-lock', 'osv-scanner lockfile scan'],
  ['osv-call', 'osv-scanner call analysis'],
  ['solana-verify', 'solana-verify reproducible build'],
  ['deployed-compare', 'deployed .so comparison'],
  ['zap', 'OWASP ZAP'],
  ['live-probe', 'production host and RPC'],
];

// These two are gaps by rule, on every run.
const FIXED = {
  'deployed-compare': 'Deployed program bytes were not compared. This pass does not contact an RPC.',
  'live-probe': 'No production host or RPC was contacted.',
};

export function osvOfflineMiss(text) {
  return /no offline (?:database|version of the osv database)|databases are not cached|failed to download/i.test(String(text || ''));
}

function pending(id, detail) {
  return { id, result: 'pending', detail };
}
function impossible(id, detail) {
  return { id, result: 'impossible', detail };
}

export function assess(tree) {
  const checks = [];
  const locks = tree.cargoLocks.items;
  checks.push(locks.length
    ? pending('cargo-build', locks.join(', '))
    : impossible('cargo-build', 'No Cargo.lock. A manifest without a lockfile is not fetched.'));
  checks.push(tree.buildScripts.items.length
    ? pending('build-sh', tree.buildScripts.items.join(', '))
    : impossible('build-sh', 'No build.sh at the repository root or one directory down.'));
  checks.push(locks.length
    ? pending('cargo-test', locks.join(', '))
    : impossible('cargo-test', 'No Cargo.lock.'));
  checks.push(tree.testScripts.items.length
    ? pending('test-sh', tree.testScripts.items.join(', '))
    : impossible('test-sh', 'No test.sh at the repository root or one directory down.'));
  const versioned = tree.anchors.filter((a) => a.anchorVersion);
  if (!tree.anchors.length) checks.push(impossible('anchor-build', 'No Anchor.toml.'));
  else if (!versioned.length) checks.push(impossible('anchor-build', 'Anchor.toml has no anchor_version and no anchor-lang version, so the Anchor CLI was not downloaded.'));
  else checks.push(pending('anchor-build', versioned.map((a) => `${a.rel} @ ${a.anchorVersion}`).join(', ')));
  checks.push(tree.npmLocks.items.length
    ? pending('npm-install', tree.npmLocks.items.join(', '))
    : impossible('npm-install', tree.packageJsonNoLock.items.length
      ? `package.json has no lockfile (${tree.packageJsonNoLock.items.join(', ')}), so npm install was not run.`
      : 'No package-lock.json.'));
  checks.push(tree.pnpmLocks.items.length
    ? pending('pnpm-install', tree.pnpmLocks.items.join(', '))
    : impossible('pnpm-install', 'No pnpm-lock.yaml.'));
  checks.push(tree.yarnOnly.items.length
    ? pending('yarn-install', `${tree.yarnOnly.items.join(', ')} (frozen install)`)
    : impossible('yarn-install', tree.yarnLocks.items.length
      ? 'An npm or pnpm lockfile is present, so yarn install was not run.'
      : 'No yarn.lock.'));
  if (tree.npmLocks.items.length || tree.pnpmLocks.items.length) checks.push(pending('npm-audit', 'lockfile present'));
  else if (tree.yarnOnly.items.length) checks.push(pending('npm-audit', 'yarn audit'));
  else checks.push(impossible('npm-audit', 'No package-lock.json, pnpm-lock.yaml, or yarn.lock. Versions of unpinned packages are outside this run.'));
  checks.push(locks.length
    ? pending('cargo-audit', locks.join(', '))
    : impossible('cargo-audit', 'No Cargo.lock.'));
  const anyLock = locks.length || tree.npmLocks.items.length || tree.pnpmLocks.items.length || tree.yarnOnly.items.length || (tree.osvExtra || []).length;
  const ecos = [...new Set((tree.osvExtra || []).map((item) => item.ecosystem))];
  checks.push(anyLock
    ? pending('osv-lock', `crates.io and npm databases are in the image.${ecos.length ? ` The host downloads ${ecos.join(', ')} and mounts it read-only.` : ''}`)
    : impossible('osv-lock', 'No lockfile for osv-scanner.'));
  checks.push(locks.length
    ? pending('osv-call', 'rust call analysis runs dependency build.rs inside the sandbox')
    : impossible('osv-call', 'No Cargo.lock. Call analysis was not run, so osv-scanner did not execute build.rs.'));
  const pinned = tree.anchors.find((a) => a.solanaVersion && safeRel(a.rel));
  checks.push(pinned
    ? pending('solana-verify', `${pinned.rel} solana ${pinned.solanaVersion}`)
    : impossible('solana-verify', 'No pinned Solana version (Anchor.toml solana_version or workspace.metadata.cli solana). The image tag is not guessed, and the Docker socket is not mounted.'));
  checks.push(impossible('deployed-compare', FIXED['deployed-compare']));
  checks.push(tree.webStart
    ? pending('zap', `local ${tree.webStart.script} in ${tree.webStart.rel}, then ZAP against 127.0.0.1 only`)
    : impossible('zap', 'No locked package.json start script. ZAP is not pointed at a host named in the repository.'));
  checks.push(impossible('live-probe', FIXED['live-probe']));
  return checks;
}

export function blocked(reason) {
  return CHECKS.map(([id]) => ({ id, result: 'impossible', detail: FIXED[id] || reason }));
}

export function settle(checks) {
  const byId = new Map((checks || []).map((c) => [c.id, c]));
  return CHECKS.map(([id]) => {
    const row = byId.get(id);
    if (!row || row.result === 'pending') {
      return { id, result: 'impossible', detail: row?.detail && row.result !== 'pending' ? row.detail : (FIXED[id] || 'Not run.') };
    }
    return { id, result: row.result, detail: row.detail || '' };
  });
}

function cell(value) {
  return String(value || '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 360);
}

export function render(checks, note) {
  const rows = settle(checks);
  const lines = [
    '# Sandbox',
    '',
    'Disposable container. Host home and the Docker socket are not mounted. Named secret files are excluded, but arbitrary source files may still contain secrets. Egress is an allowlist proxy for crates.io, registry.npmjs.org, registry.yarnpkg.com, pypi.org, files.pythonhosted.org, and GitHub; this limits destinations, not data leaving to allowed hosts. Target processes share writable result storage with the sandbox reporter, so rows are sandbox-reported, not authenticated evidence. OpenSSL build scripts use the image library. A Python test project gets a wheel-only environment (no sdist build, no target code) on the Python version it declares before the network is detached. PyPI, Go, and Maven databases are downloaded on the host when those lockfiles exist and mounted read-only. A pinned Solana version prefetches platform-tools on the host. Deployed bytes are compared only when --rpc is passed. The container and its network are removed at the end.',
    '',
    '`ran` means the command finished (a scanner exit 1 means it reported advisories). `failed` means the command was started and exited non-zero. `impossible` means it was not started. Logs are under `harness/sandbox-run/`. Built programs are copied to `files/` before the work volume is removed.',
    '',
    '| check | result | detail |',
    '|---|---|---|',
  ];
  const labels = new Map(CHECKS);
  for (const row of rows) {
    lines.push(`| ${labels.get(row.id) || row.id} | ${row.result} | ${cell(row.detail)} |`);
  }
  if (note) lines.push('', cell(note));
  lines.push('');
  return lines.join('\n');
}

export function writeReports(results, sandboxPath, summaryPath) {
  const md = render(results.checks || [], results.note || '');
  fs.mkdirSync(path.dirname(sandboxPath), { recursive: true });
  fs.writeFileSync(sandboxPath, md);
  const prev = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : '# Harness\n';
  const stripped = prev.replace(/\n# Sandbox[\s\S]*$/, '\n');
  fs.writeFileSync(summaryPath, `${stripped.trimEnd()}\n\n${md}`);
}

export function seedOsv(src, tree, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const item of tree.osvExtra || []) {
    const rel = safeRel(item.rel);
    if (!rel || rel === '.') continue;
    const from = path.join(src, rel);
    let st;
    try { st = fs.statSync(from); } catch { continue; }
    if (!st.isFile()) continue;
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    n += 1;
  }
  return n;
}


async function main() {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  if (cmd === 'copy') copyTree(a, b);
  else if (cmd === 'plan') process.stdout.write(`${JSON.stringify(plan(a))}\n`);
  else if (cmd === 'assess') process.stdout.write(`${JSON.stringify(assess(readJson(a, {})))}\n`);
  else if (cmd === 'solana') {
    const tree = readJson(a, {});
    const hit = (tree.anchors || []).find((x) => x.solanaVersion && safeRel(x.rel));
    if (!hit) process.exit(2);
    process.stdout.write(`${hit.solanaVersion}\t${safeRel(hit.rel)}\n`);
  } else if (cmd === 'blocked') {
    fs.mkdirSync(path.dirname(a), { recursive: true });
    fs.writeFileSync(a, `${JSON.stringify({ checks: blocked(b), note: b }, null, 2)}\n`);
  } else if (cmd === 'merge') {
    const cur = readJson(a, { checks: [] });
    const checks = (cur.checks || []).filter((row) => row.id !== b);
    checks.push({ id: b, result: c, detail: d || '' });
    fs.writeFileSync(a, `${JSON.stringify({ ...cur, checks }, null, 2)}\n`);
  } else if (cmd === 'render') {
    writeReports(readJson(a, { checks: blocked('No sandbox results.') }), b, c);
  } else if (cmd === 'rpc') {
    const ok = rpcAllowed(a);
    if (!ok) process.exit(2);
    process.stdout.write(ok);
  } else if (cmd === 'osv-seed') {
    process.stdout.write(String(seedOsv(b, readJson(a, {}), c)));
  } else if (cmd === 'compare') {
    process.stdout.write(`${JSON.stringify(await compareDeployed(a, b, c))}\n`);
  } else if (cmd === 'export') {
    process.stdout.write(`${exportArtifacts(a, b, c || '')}\n`);
  } else {
    process.stderr.write('usage: sandbox-lib.mjs copy|plan|assess|solana|blocked|merge|render|rpc|osv-seed|compare|export ...\n');
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { process.stderr.write(`${err.message || err}\n`); process.exit(1); });
}
