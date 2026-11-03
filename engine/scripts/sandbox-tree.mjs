// Read-only walk of the untrusted target tree: the staged copy (named secret files and symlinks stay behind) and the
// preparation plan (lockfiles, build/test scripts, Anchor/Solana pins, OSV extras, a local web start script).
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIR = new Set(['.git', 'node_modules', 'target', 'dist', '.next', 'coverage', '.cargo', '.ssh', '.aws', '.docker', '.kube', 'secrets']);
const MAX = 4;
const SEMVER = /^\d+\.\d+\.\d+$/;
// Lockfiles whose offline OSV database is not baked into the image.
// The host downloads these. The target container never reaches the OSV API.
const OSV_NAME = new Map([
  ['requirements.txt', 'PyPI'],
  ['poetry.lock', 'PyPI'],
  ['Pipfile.lock', 'PyPI'],
  ['pdm.lock', 'PyPI'],
  ['uv.lock', 'PyPI'],
  ['go.mod', 'Go'],
  ['pom.xml', 'Maven'],
  ['gradle.lockfile', 'Maven'],
]);

export function safeRel(rel) {
  if (rel === '.') return '.';
  if (!rel || typeof rel !== 'string') return null;
  if (rel.startsWith('/') || rel.includes('..') || rel.includes('\\') || /\s/.test(rel)) return null;
  if (!/^[A-Za-z0-9._@+/-]+$/.test(rel)) return null;
  return rel;
}

function skipFile(name) {
  if (name === '.env') return true;
  if (name.startsWith('.env.') && !name.endsWith('.example') && !name.endsWith('.sample') && !name.endsWith('.template')) return true;
  const lower = name.toLowerCase();
  if (['id.json', '.npmrc', '.netrc', '.pypirc', '.git-credentials', '.envrc'].includes(lower)) return true;
  if (/keypair.*\.json$|\.pem$|\.key$|\.p12$|\.pfx$|^id_(rsa|ed25519|ecdsa|dsa)/.test(lower)) return true;
  return false;
}

export function walk(root, visit, dir = root, depth = 0) {
  if (depth > 6) return;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of ents) {
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (SKIP_DIR.has(ent.name)) continue;
      if (ent.name === 'secrets' && path.basename(dir) === 'deploy') continue;
      walk(root, visit, path.join(dir, ent.name), depth + 1);
    } else if (ent.isFile()) {
      const rel = path.relative(root, path.join(dir, ent.name)).split(path.sep).join('/');
      visit(path.join(dir, ent.name), rel);
    }
  }
}

export function readText(file) {
  try {
    if (fs.statSync(file).size > 1_000_000) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

function quoted(text, key) {
  const m = String(text || '').match(new RegExp(`^\\s*${key}\\s*=\\s*"(\\d+\\.\\d+\\.\\d+)"`, 'm'));
  return m && SEMVER.test(m[1]) ? m[1] : null;
}

function anchorLang(text) {
  const direct = String(text || '').match(/anchor-lang\s*=\s*"(\d+\.\d+\.\d+)"/);
  if (direct && SEMVER.test(direct[1])) return direct[1];
  const obj = String(text || '').match(/anchor-lang\s*=\s*\{[^}]*version\s*=\s*"(\d+\.\d+\.\d+)"/);
  return obj && SEMVER.test(obj[1]) ? obj[1] : null;
}

function cliSolana(text) {
  const section = String(text || '').split('[workspace.metadata.cli]')[1];
  if (!section) return null;
  return quoted(section.split(/\n\[/)[0], 'solana');
}

function shallow(rel, name) {
  return rel === name || new RegExp(`^[^/]+/${name}$`).test(rel);
}

function cap(list) {
  return { items: list.slice(0, MAX), total: list.length };
}

export function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.isSymbolicLink()) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR.has(ent.name)) continue;
      if (ent.name === 'secrets' && path.basename(src) === 'deploy') continue;
      copyTree(from, to);
    } else if (ent.isFile()) {
      if (skipFile(ent.name)) continue;
      fs.copyFileSync(from, to);
    }
  }
}

export function plan(root) {
  const files = [];
  walk(root, (abs, rel) => files.push({ abs, rel }));
  const has = (rel) => files.some((f) => f.rel === rel);
  const cargoLocks = [];
  const buildScripts = [];
  const testScripts = [];
  const anchors = [];
  const npmLocks = [];
  const pnpmLocks = [];
  const packageJsonNoLock = [];
  const yarnLocks = [];
  const yarnOnly = [];
  const osvExtra = [];
  const starts = [];
  for (const f of files) {
    if (f.rel.endsWith('/Cargo.lock') || f.rel === 'Cargo.lock') cargoLocks.push(f.rel);
    if (f.rel.endsWith('/yarn.lock') || f.rel === 'yarn.lock') yarnLocks.push(f.rel);
    const name = f.rel.split('/').pop();
    const eco = OSV_NAME.get(name) || (/^requirements[\w.-]*\.txt$/.test(name) ? 'PyPI' : undefined);
    if (eco && osvExtra.length < 8) osvExtra.push({ rel: f.rel, ecosystem: eco });
    if (shallow(f.rel, 'build.sh')) buildScripts.push(f.rel);
    if (shallow(f.rel, 'test.sh')) testScripts.push(f.rel);
    if (f.rel.endsWith('/package-lock.json') || f.rel === 'package-lock.json') npmLocks.push(f.rel);
    if (f.rel.endsWith('/pnpm-lock.yaml') || f.rel === 'pnpm-lock.yaml') pnpmLocks.push(f.rel);
  }
  for (const f of files) {
    if (!f.rel.endsWith('/Anchor.toml') && f.rel !== 'Anchor.toml') continue;
    const dir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '.';
    const cargoRel = dir === '.' ? 'Cargo.toml' : `${dir}/Cargo.toml`;
    const rootCargo = files.find((x) => x.rel === 'Cargo.toml');
    const anchorText = readText(f.abs);
    const cargoText = readText(path.join(root, cargoRel));
    const rootText = rootCargo ? readText(rootCargo.abs) : '';
    const childVersions = [...new Set(files.filter(item => item.rel.startsWith(dir === '.' ? 'programs/' : `${dir}/programs/`) && item.rel.endsWith('/Cargo.toml')).map(item => anchorLang(readText(item.abs))).filter(Boolean))];
    const rel = safeRel(dir);
    if (!rel) continue;
    anchors.push({
      rel,
      anchorVersion: quoted(anchorText, 'anchor_version') || anchorLang(cargoText) || anchorLang(rootText) || (childVersions.length === 1 ? childVersions[0] : null),
      solanaVersion: quoted(anchorText, 'solana_version') || cliSolana(cargoText) || cliSolana(rootText),
    });
  }
  for (const f of files) {
    if (!f.rel.endsWith('/package.json') && f.rel !== 'package.json') continue;
    const dir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '.';
    const lock = (name) => (dir === '.' ? name : `${dir}/${name}`);
    const npm = has(lock('package-lock.json'));
    const pnpm = has(lock('pnpm-lock.yaml'));
    const yarn = has(lock('yarn.lock'));
    if (!npm && !pnpm && yarn) yarnOnly.push(f.rel);
    else if (!npm && !pnpm) packageJsonNoLock.push(f.rel);
    let scripts = null;
    try { scripts = JSON.parse(readText(f.abs) || '{}').scripts; } catch { scripts = null; }
    if (scripts && typeof scripts.start === 'string' && scripts.start.trim() && (npm || pnpm || yarn)) {
      const rel = safeRel(dir);
      if (rel) starts.push({ rel, depth: rel === '.' ? 0 : rel.split('/').length });
    }
  }
  starts.sort((a, b) => a.depth - b.depth);
  return {
    cargoLocks: cap(cargoLocks),
    buildScripts: cap(buildScripts),
    testScripts: cap(testScripts),
    anchors: anchors.slice(0, MAX),
    npmLocks: cap(npmLocks),
    pnpmLocks: cap(pnpmLocks),
    packageJsonNoLock: cap(packageJsonNoLock),
    yarnLocks: cap(yarnLocks),
    yarnOnly: cap(yarnOnly),
    osvExtra,
    webStart: starts[0] ? { rel: starts[0].rel, script: 'start' } : null,
  };
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
