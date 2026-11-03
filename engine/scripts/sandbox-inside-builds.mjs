// Full-sandbox build checks (not review mode): locked cargo build/test, build.sh/test.sh, and anchor build.
import fs from 'node:fs';
import path from 'node:path';
import { safeRel } from './sandbox-lib.mjs';
import { CARGO_ENV, OPENSSL_NOTE, brief, dirOf, log, run } from './sandbox-inside-exec.mjs';
import { put, timeLeft } from './sandbox-inside-state.mjs';

export async function cargoLocked(id, args, rels) {
  const bits = [];
  let worst = 'ran';
  for (const rel of rels) {
    if (timeLeft() < 20_000) { worst = 'impossible'; bits.push(`${rel} skipped at the time limit`); break; }
    const cwd = dirOf(path.posix.dirname(rel));
    if (!cwd) { worst = 'failed'; bits.push(`${rel} path refused`); continue; }
    const res = await run('cargo', args, { cwd, timeoutMs: 15 * 60 * 1000, env: CARGO_ENV });
    log(id, res);
    if (res.code !== 0) worst = 'failed';
    bits.push(`${rel} ${brief(res)}`);
  }
  if (worst === 'ran') bits.push(OPENSSL_NOTE);
  put(id, worst === 'ran' ? 'ran' : worst, bits.join('; '));
}

export async function scripts(id, rels) {
  const bits = [];
  let worst = 'ran';
  for (const rel of rels) {
    if (timeLeft() < 20_000) { worst = 'impossible'; bits.push(`${rel} skipped at the time limit`); break; }
    const cwd = dirOf(path.posix.dirname(rel));
    const file = path.join('/work/src', rel);
    if (!cwd || !safeRel(rel)) { worst = 'failed'; bits.push(`${rel} path refused`); continue; }
    const res = await run('bash', [file], { cwd, timeoutMs: 15 * 60 * 1000, env: CARGO_ENV });
    log(id, res);
    if (res.code !== 0) worst = 'failed';
    bits.push(`${rel} ${brief(res)}`);
  }
  put(id, worst, bits.join('; '));
}

function findBin(dir, name, depth = 0) {
  if (depth > 3) return null;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const ent of ents) {
    if (ent.isSymbolicLink()) continue;
    const p = path.join(dir, ent.name);
    if (ent.isFile() && ent.name === name) return p;
    if (ent.isDirectory()) {
      const hit = findBin(p, name, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

async function installAnchor(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { code: 1, out: 'version refused' };
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const tag = `v${version}`;
  const base = `https://github.com/coral-xyz/anchor/releases/download/${tag}`;
  fs.mkdirSync('/work/bin', { recursive: true });
  const unpackDir = `/tmp/anchor-unpack-${version}`;
  fs.mkdirSync(unpackDir, { recursive: true });
  const tar = `${unpackDir}.tar.gz`;
  const tarUrl = `${base}/anchor-${version}-${arch}-unknown-linux-gnu.tar.gz`;
  let res = await run('curl', ['-fsSL', '--retry', '2', '-o', tar, tarUrl], { cwd: '/tmp', timeoutMs: 180_000 });
  if (res.code === 0) {
    const unpacked = await run('tar', ['-xzf', tar, '-C', unpackDir], { cwd: '/tmp', timeoutMs: 60_000 });
    if (unpacked.code !== 0) return unpacked;
    const bin = findBin(unpackDir, 'anchor');
    if (!bin) return { code: 1, out: 'tarball had no anchor binary' };
    fs.copyFileSync(bin, '/work/bin/anchor');
    fs.chmodSync('/work/bin/anchor', 0o755);
    return { code: 0, out: `installed ${version}` };
  }
  const raw = `${base}/anchor-${version}-${arch}-unknown-linux-gnu`;
  const dest = '/work/bin/anchor';
  res = await run('curl', ['-fsSL', '--retry', '2', '-o', dest, raw], { cwd: '/tmp', timeoutMs: 180_000 });
  if (res.code === 0) fs.chmodSync(dest, 0o755);
  return res;
}

export async function anchorBuild(tree) {
  const bits = [];
  let worst = 'ran';
  const seen = new Set();
  for (const item of tree.anchors) {
    if (!item.anchorVersion || seen.has(item.anchorVersion)) continue;
    seen.add(item.anchorVersion);
    const installed = await installAnchor(item.anchorVersion);
    log('anchor-build', installed);
    if (installed.code !== 0) {
      put('anchor-build', 'failed', `${item.rel} @ ${item.anchorVersion} ${brief(installed)}`);
      return;
    }
  }
  for (const item of tree.anchors.filter((a) => a.anchorVersion)) {
    if (timeLeft() < 20_000) { worst = 'impossible'; bits.push('time limit'); break; }
    const cwd = dirOf(item.rel);
    if (!cwd) { worst = 'failed'; bits.push(`${item.rel} path refused`); continue; }
    const tools = fs.existsSync('/opt/platform-tools') ? { SOLANA_PLATFORM_TOOLS_DIR: '/opt/platform-tools' } : {};
    const res = await run('anchor', ['build'], { cwd, timeoutMs: 20 * 60 * 1000, env: { ...CARGO_ENV, ...tools } });
    log('anchor-build', res);
    if (res.code !== 0) worst = 'failed';
    bits.push(`${item.rel} @ ${item.anchorVersion} ${brief(res)}`);
  }
  if (worst === 'ran') bits.push(OPENSSL_NOTE);
  put('anchor-build', worst, bits.join('; ') || 'no versioned Anchor.toml');
}
