// Shared pieces of the Codex and Grok native admission: owner-only cache files, the streamed binary hash,
// the receipt check and the admitted-binary lookup. Both recipes hash this file, so a change here
// invalidates every admission receipt and the operator re-admits once.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const failure = (code) => (typeof code === 'function' ? code() : new Error(code));
const ownedPrivately = (stat) => stat.uid === process.getuid() && !(stat.mode & 0o077);

export async function sha256File(file) {
  const digest = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}

export function privateDirectory(dir, code = 'native_cache_not_private') {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !ownedPrivately(stat)) throw failure(code);
}

// An owner-only, singly linked regular file opened for a full rewrite. A link or a shared file is refused.
export function openPrivateOutput(file) {
  privateDirectory(path.dirname(file));
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || !ownedPrivately(stat)) throw new Error('native_output_file_rejected');
    fs.ftruncateSync(fd, 0);
    return fd;
  } catch (err) { fs.closeSync(fd); throw err; }
}

export function writePrivateOutput(file, bytes) {
  const fd = openPrivateOutput(file);
  try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
}

export function writePrivateJson(file, value) {
  writePrivateOutput(file, JSON.stringify(value, null, 2));
}

// The receipt next to an admitted binary, read only from an owner-only cache, never through a link.
export function readPrivateReceipt(cache, name = 'runtime-admission.json', maxBytes = 16_384) {
  const parent = fs.lstatSync(cache);
  if (!parent.isDirectory() || parent.isSymbolicLink() || !ownedPrivately(parent)) throw new Error('native_cache_rejected');
  const fd = fs.openSync(path.join(cache, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || !ownedPrivately(stat) || stat.size > maxBytes) throw new Error('native_receipt_rejected');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}

// A receipt admits only the current package and recipe, a pinned source, a recorded binary hash and every gate, in order.
// `pins` lists the receipt fields that must equal fixed values (sourceCommit, sourceRevision, ...).
export function matchesAdmission(receipt, identity, gates, pins) {
  return receipt?.version === 1 && receipt.admission === true
    && Object.entries(pins).every(([key, value]) => receipt[key] === value)
    && receipt.packageDigest === identity.packageDigest && receipt.recipeDigest === identity.recipeDigest
    && typeof receipt.binarySha256 === 'string' && /^[a-f0-9]{64}$/.test(receipt.binarySha256)
    && Array.isArray(receipt.gates) && receipt.gates.length === gates.length
    && gates.every((name, i) => receipt.gates[i]?.name === name && receipt.gates[i]?.passed === true);
}

// The binary a current receipt admits: owner-owned, not a link, executable, and hashing to the recorded sha256.
export async function verifyAdmittedBinary({ cache, binary, matches }) {
  const receipt = readPrivateReceipt(cache);
  if (!matches(receipt)) throw new Error('native_receipt_stale');
  const stat = fs.lstatSync(binary);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid() || stat.size > 4 * 1024 ** 3) throw new Error('native_binary_rejected');
  fs.accessSync(binary, fs.constants.X_OK);
  if (await sha256File(binary) !== receipt.binarySha256) throw new Error('native_binary_changed');
  return receipt;
}

// The environment the node and docker admission gates run the repository's own suites with.
const GATE_ENV_KEYS = ['HOME', 'USER', 'PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'];
export function gateTestEnv(env = process.env) {
  return Object.fromEntries(GATE_ENV_KEYS.filter((key) => typeof env[key] === 'string').map((key) => [key, env[key]]));
}

export const DOCKER_GATE_SUITES = Object.freeze(['worker-isolation', 'terminal-relay', 'terminal-model-connector', 'static-cli-review', 'grok-docker']);

// Node and docker gate argv over the repository's scripts/ suites.
export function suiteGateArgv(scripts, kind) {
  const node = [process.execPath, '--test', '--test-concurrency=1', '--test-reporter=tap'];
  const files = kind === 'node'
    ? fs.readdirSync(scripts).filter((name) => name.endsWith('.test.mjs')).sort()
    : DOCKER_GATE_SUITES.map((name) => `${name}.docker.mjs`);
  return [...node, ...files.map((name) => path.join(scripts, name))];
}

export const suitesPassed = (text) => /# pass [1-9][0-9]*\b/.test(text) && /# fail 0\b/.test(text) && /# skipped 0\b/.test(text);
