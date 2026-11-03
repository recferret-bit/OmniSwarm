// Built program artifacts: export of deploy/*.so and idl/*.json into the report, and the optional host-side comparison
// of built bytes against the deployed program at an operator-typed --rpc URL.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { rpcAllowed, ipAllowed } from './sandbox-net.mjs';
import { walk, readText, readJson } from './sandbox-tree.mjs';

const B58 = '[1-9A-HJ-NP-Za-km-z]{32,44}';

export function programIds(root) {
  const ids = [];
  const push = (id) => { if (id && !ids.includes(id) && ids.length < 4) ids.push(id); };
  walk(root, (abs, rel) => {
    if (ids.length >= 4) return;
    const text = readText(abs);
    if (rel.endsWith('.rs')) {
      for (const match of text.matchAll(new RegExp(`declare_id!\\s*\\(\\s*"(${B58})"`, 'g'))) push(match[1]);
    }
    if (rel === 'Anchor.toml' || rel.endsWith('/Anchor.toml')) {
      for (const part of text.split(/^\[programs\.[^\]]+\]/m).slice(1)) {
        const body = part.split(/\n\[/)[0];
        for (const match of body.matchAll(new RegExp(`^[A-Za-z0-9_-]+\\s*=\\s*"(${B58})"`, 'gm'))) push(match[1]);
      }
    }
  });
  return ids;
}

function elfHash(buf) {
  const at = buf.indexOf(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  if (at < 0) return null;
  return crypto.createHash('sha256').update(buf.subarray(at)).digest('hex');
}

function soFiles(dir, depth = 0, out = []) {
  if (depth > 4 || !dir) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of ents) {
    if (ent.isSymbolicLink()) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) soFiles(p, depth + 1, out);
    else if (ent.isFile() && ent.name.endsWith('.so') && out.length < 8) out.push(p);
  }
  return out;
}

const ARTIFACT_SKIP = new Set(['node_modules', '.git', 'deps', 'incremental', '.fingerprint', 'registry', 'git', 'build', 'examples']);
const SO_MAX = 8 * 1024 * 1024;
const IDL_MAX = 2 * 1024 * 1024;
const ARTIFACT_TOTAL = 64 * 1024 * 1024;
const ARTIFACT_COUNT = 40;

function wantedArtifact(rel, size) {
  const base = path.posix.basename(rel);
  if (!base || base.includes('keypair') || base.startsWith('.env')) return false;
  const parent = path.posix.basename(path.posix.dirname(rel));
  if (base.endsWith('.so')) return size > 0 && size <= SO_MAX && parent !== 'deps';
  if (base.endsWith('.json') && parent === 'idl') return size > 0 && size <= IDL_MAX;
  return false;
}

function walkArtifacts(dir, rel, visit, depth) {
  if (depth > 8) return;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of ents) {
    if (ent.isSymbolicLink()) continue;
    const abs = path.join(dir, ent.name);
    const next = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (ARTIFACT_SKIP.has(ent.name)) continue;
      walkArtifacts(abs, next, visit, depth + 1);
    } else if (ent.isFile()) visit(abs, next);
  }
}

// A sandbox work volume keeps cargo output under target/. A solana-verify
// directory is already the target dir (deploy/ at its root). Package-local
// target/ dirs under src/ are included. The cargo registry is not walked.
function exportRoots(root) {
  const roots = [];
  const target = path.join(root, 'target');
  if (fs.existsSync(target)) roots.push({ abs: target, rel: 'target' });
  const src = path.join(root, 'src');
  if (fs.existsSync(src)) {
    const add = (dir, rel, depth) => {
      if (depth > 4) return;
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of ents) {
        if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        const childRel = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.name === 'target') roots.push({ abs: path.join(dir, ent.name), rel: childRel });
        else add(path.join(dir, ent.name), childRel, depth + 1);
      }
    };
    add(src, 'src', 0);
  }
  if (!roots.length) roots.push({ abs: root, rel: '' });
  return roots;
}

// Copies deploy *.so and idl/*.json into the report's files/ directory.
// Keypairs, symlinks, deps, and the cargo registry stay behind. Returns how
// many files this call added. An existing manifest is kept and extended.
export function exportArtifacts(root, dest, prefix = '') {
  fs.mkdirSync(dest, { recursive: true });
  const manifestPath = path.join(dest, 'manifest.json');
  const prev = readJson(manifestPath, []);
  const items = Array.isArray(prev) ? prev.filter((row) => row && typeof row.path === 'string') : [];
  const seen = new Set(items.map((row) => row.path));
  let total = items.reduce((sum, row) => sum + (Number(row.bytes) || 0), 0);
  let added = 0;
  const put = (abs, rel) => {
    if (items.length >= ARTIFACT_COUNT || total >= ARTIFACT_TOTAL) return;
    let st;
    try { st = fs.lstatSync(abs); } catch { return; }
    if (!st.isFile() || st.isSymbolicLink() || !wantedArtifact(rel, st.size)) return;
    const destRel = path.posix.join(prefix || '', rel).replace(/^\//, '');
    if (!destRel || destRel.split('/').includes('..') || seen.has(destRel)) return;
    if (total + st.size > ARTIFACT_TOTAL) return;
    const to = path.join(dest, destRel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(abs, to);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(to)).digest('hex');
    items.push({ path: destRel, bytes: st.size, sha256: hash });
    seen.add(destRel);
    total += st.size;
    added += 1;
  };
  for (const start of exportRoots(root)) walkArtifacts(start.abs, start.rel, put, 0);
  fs.writeFileSync(manifestPath, `${JSON.stringify(items, null, 2)}\n`);
  return added;
}

export async function compareDeployed(rpc, src, soDir) {
  const allowed = rpcAllowed(rpc);
  if (!allowed) {
    return { result: 'impossible', detail: 'The --rpc URL was refused. It must be https, with no credentials, and not a private, link-local, or metadata address.' };
  }
  const ids = programIds(src);
  if (!ids.length) return { result: 'impossible', detail: 'No declare_id! or Anchor program id was found, so the RPC was not queried.' };
  const files = soFiles(soDir);
  if (!files.length) return { result: 'impossible', detail: 'No .so was produced, so the deployed program was not compared.' };
  const host = new URL(allowed).hostname.replace(/^\[|\]$/g, '');
  if (!host.includes(':') && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    let addrs = [];
    try { addrs = await dns.lookup(host, { all: true }); } catch { return { result: 'failed', detail: `The RPC host did not resolve: ${host}` }; }
    if (!addrs.length || addrs.some((item) => !ipAllowed(item.address))) {
      return { result: 'impossible', detail: 'The RPC host resolved to a private or metadata address, so it was not queried.' };
    }
  }
  const built = files.map((file) => ({ file: path.basename(file), hash: elfHash(fs.readFileSync(file)) })).filter((item) => item.hash);
  if (!built.length) return { result: 'failed', detail: 'The build produced .so files, and none of them is an ELF.' };
  const bits = [];
  let worst = 'ran';
  for (const id of ids) {
    let body;
    try {
      const res = await fetch(allowed, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [id, { encoding: 'base64' }] }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status >= 300 && res.status < 400) {
        worst = 'impossible';
        bits.push(`${id} redirect refused`);
        continue;
      }
      body = await res.json();
    } catch (err) {
      worst = 'failed';
      bits.push(`${id} ${err.message || err}`);
      continue;
    }
    const data = body && body.result && body.result.value && body.result.value.data;
    const b64 = Array.isArray(data) ? data[0] : null;
    if (!b64) {
      worst = 'failed';
      bits.push(`${id} account is empty`);
      continue;
    }
    const hash = elfHash(Buffer.from(b64, 'base64'));
    const hit = hash && built.find((item) => item.hash === hash);
    if (!hash) {
      worst = 'failed';
      bits.push(`${id} account has no ELF`);
    } else if (!hit) {
      worst = 'failed';
      bits.push(`${id} on-chain ${hash.slice(0, 12)} matches none of the built files`);
    } else {
      bits.push(`${id} matches ${hit.file} ${hash.slice(0, 12)}`);
    }
  }
  return { result: worst, detail: `Host queried the RPC you passed. The container did not. ${bits.join('; ')}` };
}
