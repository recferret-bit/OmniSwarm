// Reviewer reads: list_files, read_file and search_code, and the R-02 record of the source they were served.
// Three backends share the walkers in bridge-programs.mjs:
//   container   the sealed /src in the sandbox (the review path)
//   demo-host   the bundled demo fixture on the host (no container)
//   host leads  /out/harness and /out/crosscheck served from the orchestrator's copies in the report directory.
//               Target suites run as uid 10001 with /out writable; the host copies were taken before any suite
//               ran and are not mounted into the container, so a suite cannot rewrite the leads reviewers read (R-04).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readReportJson, readReportText } from './report-contract.mjs';
import { BridgeError, SEALED_SOURCE, displayPath, resolveContainerPath, runProgram, truncationMarker } from './bridge-container.mjs';
import {
  LIST_FILES_SCRIPT, READ_FILE_SCRIPT, SEARCH_CODE_SCRIPT, SEARCH_LINE_CHARS, SKIP_DIRS, SOURCE_DIGEST_SCRIPT,
  listTree, readSlice, searchTree, sourceTreeDigest,
} from './bridge-programs.mjs';

export const SOURCE_READ_DIGEST_FILE = 'harness/source-read-digest.json';

// Same digest the container computes over /src. Demo-host reads use it so harness/source-read-digest.json can
// match source-manifest.json without a container.
export function digestTree(root) {
  return sourceTreeDigest(fs, path, crypto, root);
}

// First read from /src records what reviewers were served (R-02). First writer wins; later bridges compare.
function recordSourceDigest(ctx, seen) {
  if (!/^[a-f0-9]{64}$/.test(seen.digest) || !Array.isArray(seen.files)) throw new Error('Cannot compute the digest of the sealed source');
  const record = `${JSON.stringify({ version: 1, source: SEALED_SOURCE, digest: seen.digest, files: seen.files, at: new Date().toISOString() })}\n`;
  const target = path.join(ctx.reportDir, SOURCE_READ_DIGEST_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, record, { mode: 0o600, flag: 'wx' });
  try { fs.linkSync(temp, target); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const first = readReportJson(ctx.reportDir, SOURCE_READ_DIGEST_FILE, 64 * 1024 * 1024);
    if (first.digest !== seen.digest) throw new BridgeError('SOURCE_DIGEST_MISMATCH', 'The sealed source served now differs from the source served at the first read');
  } finally { fs.rmSync(temp, { force: true }); }
  ctx.sourceDigestChecked = true;
}

const underSource = (containerPath) => containerPath === SEALED_SOURCE || containerPath.startsWith(`${SEALED_SOURCE}/`);

export async function ensureSourceReadDigest(ctx, containerPath) {
  if (ctx.sourceDigestChecked || !ctx.reportDir) return;
  if (ctx.demoHost) { recordSourceDigest(ctx, digestTree(ctx.demoHost)); return; }
  if (!ctx.container || !underSource(containerPath)) return;
  const res = await runProgram(ctx, SOURCE_DIGEST_SCRIPT, [], { cwd: '/', maxBytes: 32 * 1024 * 1024, timeoutMs: 120_000 });
  let seen;
  try { seen = JSON.parse(res.stdout); } catch { throw new Error(`Cannot compute the digest of the sealed source: ${res.stderr.slice(0, 200)}`); }
  if (res.code !== 0) throw new Error('Cannot compute the digest of the sealed source');
  recordSourceDigest(ctx, seen);
}

// ---- host leads (R-04) ----
const HOST_LEADS = {
  '/out/harness': { dir: 'harness', file: /^(?:[a-z0-9][a-z0-9_-]*\.md|stack-profile\.json|scanner-results\.json|existing-tests\.json|test-artifacts\.json|prior-[a-z0-9-]+\.json)$/ },
  '/out/crosscheck': { dir: 'crosscheck', file: /^[a-z0-9][a-z0-9-]*\.json$/ },
};

function hostLeadRoot(ctx, containerPath) {
  if (!ctx.reportDir) return null;
  const root = Object.keys(HOST_LEADS).find((prefix) => containerPath === prefix || containerPath.startsWith(`${prefix}/`));
  return root ? { root, ...HOST_LEADS[root] } : null;
}

// A read-only view of the allow-listed top-level lead files, shaped like the fs calls the walkers use.
// Each file is read with the report reader (no symlink, no hard link, bounded size).
function leadFs(ctx, lead) {
  const files = new Map();
  let names = [];
  try { names = fs.readdirSync(path.join(ctx.reportDir, lead.dir)); } catch { /* no leads yet */ }
  for (const name of names.filter((entry) => lead.file.test(entry)).sort()) {
    try { files.set(`${lead.root}/${name}`, readReportText(ctx.reportDir, `${lead.dir}/${name}`)); } catch { /* not a plain bounded file: not served */ }
  }
  const entry = (name, file) => ({ name, isFile: () => file, isDirectory: () => !file, isSymbolicLink: () => false });
  const stat = (p) => {
    if (files.has(p)) return { isFile: () => true, isDirectory: () => false, size: Buffer.byteLength(files.get(p)) };
    if (p === lead.root) return { isFile: () => false, isDirectory: () => true, size: 0 };
    throw Object.assign(new Error(`No such lead file: ${p}`), { code: 'ENOENT' });
  };
  return {
    lstatSync: stat, statSync: stat,
    readFileSync: (p) => { stat(p); if (!files.has(p)) throw new Error(`Not a regular file: ${p}`); return files.get(p); },
    readdirSync: (p) => { if (p !== lead.root) throw new Error(`No such lead directory: ${p}`); return [...files.keys()].map((key) => entry(key.slice(lead.root.length + 1), true)); },
  };
}

// ---- tool handlers ----
function lineWindow(args) {
  const start = Math.max(1, Number(args.start_line) || 1);
  return [start, Math.min(start + 399, Math.max(start, Number(args.end_line) || (start + 200)))];
}

function demoHostFile(ctx, containerPath) {
  const root = fs.realpathSync(ctx.demoHost);
  const rel = containerPath === SEALED_SOURCE ? '' : containerPath.startsWith(`${SEALED_SOURCE}/`) ? containerPath.slice(SEALED_SOURCE.length + 1) : null;
  if (rel == null || rel.split('/').includes('..')) throw new Error(`path outside source: ${containerPath}`);
  const full = rel ? path.resolve(root, rel) : root;
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) throw new Error('path outside source');
  return { root, full, rel: rel || containerPath };
}

export async function listFiles(ctx, args) {
  const target = resolveContainerPath(args.path || '');
  const maxDepth = Math.min(Math.max(Number(args.max_depth) || 3, 1), 6);
  const header = `Files under ${displayPath(target)}:\n`;
  const lead = hostLeadRoot(ctx, target);
  if (lead) return header + listTree(leadFs(ctx, lead), path.posix, target, maxDepth, SKIP_DIRS);
  await ensureSourceReadDigest(ctx, target);
  if (ctx.demoHost) return header + listTree(fs, path, demoHostFile(ctx, target).full, maxDepth, SKIP_DIRS);
  const res = await runProgram(ctx, LIST_FILES_SCRIPT, [target, maxDepth]);
  if (res.code !== 0) throw new Error(res.stderr || `list_files exited with ${res.code}`);
  return header + res.stdout + truncationMarker(res);
}

export async function readFile(ctx, args) {
  const target = resolveContainerPath(args.path);
  const [start, end] = lineWindow(args);
  const lead = hostLeadRoot(ctx, target);
  if (lead) return readSlice(leadFs(ctx, lead), target, target, start, end);
  await ensureSourceReadDigest(ctx, target);
  if (ctx.demoHost) { const file = demoHostFile(ctx, target); return readSlice(fs, file.full, file.rel, start, end); }
  const res = await runProgram(ctx, READ_FILE_SCRIPT, [target, start, end]);
  if (res.code !== 0) throw new Error(res.stderr || `read_file failed for ${target}`);
  return res.stdout + truncationMarker(res);
}

export async function searchCode(ctx, args) {
  const target = resolveContainerPath(args.path || '');
  const pattern = String(args.pattern || '');
  if (!pattern) throw new Error('pattern is required');
  const limit = Math.min(Math.max(Number(args.max_results) || 80, 1), 200);
  const flags = args.case_insensitive ? 'i' : '';
  const lead = hostLeadRoot(ctx, target);
  if (lead) return searchTree(leadFs(ctx, lead), path.posix, target, SEALED_SOURCE, pattern, flags, limit, SKIP_DIRS, SEARCH_LINE_CHARS);
  await ensureSourceReadDigest(ctx, target);
  if (ctx.demoHost) { const file = demoHostFile(ctx, target); return searchTree(fs, path, file.full, file.root, pattern, flags, limit, SKIP_DIRS, SEARCH_LINE_CHARS); }
  const res = await runProgram(ctx, SEARCH_CODE_SCRIPT, [target, pattern, flags, limit]);
  if (res.code !== 0) throw new Error(res.stderr || 'search_code failed');
  return res.stdout + truncationMarker(res);
}
