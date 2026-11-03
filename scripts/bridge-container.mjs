// Container boundary of the bridge: path policy, the docker exec wrapper and its bounded output capture.
// No tool logic here; the tool handlers (bridge-reads, bridge-existing-tests, bridge-context) build on it.
import { spawn } from 'node:child_process';
import path from 'node:path';

// Reviewers keep seeing /work/src. Reads are served from /src, the read-only mount of the sealed snapshot (R-02);
// /work/src is only what the sandbox prepared and is never read for review.
export const REVIEW_SOURCE_LABEL = '/work/src';
export const SEALED_SOURCE = '/src';
export const CONTAINER_ROOTS = [SEALED_SOURCE, '/out/harness', '/out/crosscheck', '/out/auditors'];
// R-01: the bridge's in-container programs run by absolute path under a PATH with no /work entry.
export const NODE_BIN = '/usr/local/bin/node';
export const BRIDGE_PATH = '/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin';
// Suites still need Anchor from /work/bin, but it comes last, so a planted file there can never shadow a system program.
export const SUITE_PATH = `${BRIDGE_PATH}:/work/bin`;

// A refusal with a stable code at the front of the message, so a reviewer (and a test) can tell it from a malformed argument.
export class BridgeError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'BridgeError'; this.code = code; }
}

export function resolveContainerPath(inputPath, defaultRoot = REVIEW_SOURCE_LABEL) {
  const raw = String(inputPath || '').trim();
  const base = raw && raw !== '.' ? (raw.startsWith('/') ? path.posix.normalize(raw) : path.posix.normalize(path.posix.join(defaultRoot, raw))) : defaultRoot;
  // /work/src is the name reviewers know; both names read the sealed copy.
  const resolved = base === REVIEW_SOURCE_LABEL || base.startsWith(`${REVIEW_SOURCE_LABEL}/`) ? SEALED_SOURCE + base.slice(REVIEW_SOURCE_LABEL.length) : base;
  if (!CONTAINER_ROOTS.some((root) => resolved === root || resolved.startsWith(`${root}/`))) {
    throw new Error(`Path outside allowed container directories: ${raw}`);
  }
  return resolved;
}

export function displayPath(containerPath) {
  return containerPath === SEALED_SOURCE || containerPath.startsWith(`${SEALED_SOURCE}/`) ? REVIEW_SOURCE_LABEL + containerPath.slice(SEALED_SOURCE.length) : containerPath;
}

// With keepTail, an oversized stream keeps its first quarter and last three
// quarters: test runners print their summary last, so a head-only cap loses the counts.
export function boundedCapture(maxBytes, keepTail = false) {
  const headMax = keepTail ? Math.floor(maxBytes / 4) : maxBytes, tailMax = maxBytes - headMax;
  let head = Buffer.alloc(0), tail = Buffer.alloc(0), omitted = 0;
  return {
    push(chunk) {
      if (head.length < headMax) {
        const take = Math.min(headMax - head.length, chunk.length);
        head = Buffer.concat([head, chunk.subarray(0, take)]);
        chunk = chunk.subarray(take);
      }
      if (!chunk.length) return;
      if (!tailMax) { omitted += chunk.length; return; }
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > tailMax) { omitted += tail.length - tailMax; tail = tail.subarray(tail.length - tailMax); }
    },
    get omitted() { return omitted; },
    text() { return head.toString('utf8') + (omitted && tailMax ? `\n[... ${omitted} bytes omitted ...]\n` : '') + tail.toString('utf8'); },
  };
}

// R-12: a head-only capture that dropped bytes says so, so a cut line is never mistaken for the whole line.
export const truncationMarker = result => result.omittedBytes > 0 ? `\n… [truncated ${result.omittedBytes} bytes]` : '';

// The host docker client gets what it needs to reach the daemon and nothing else, so no provider key
// or endpoint in the operator's environment reaches a docker child (ORCHESTRATION 1.1).
const DOCKER_ENV_ALLOW = /^(?:PATH|HOME|USER|LOGNAME|TMPDIR|LANG|LC_[A-Z_]+|DOCKER_[A-Z_]+|XDG_RUNTIME_DIR|SSH_AUTH_SOCK|SYSTEMROOT)$/;
export function dockerClientEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => DOCKER_ENV_ALLOW.test(key)));
}

export function execInContainer(dockerBin, container, args, { cwd = SEALED_SOURCE, timeoutMs = 30_000, input = '', maxBytes = 64 * 1024, keepTail = false, path: execPath = BRIDGE_PATH } = {}) {
  return new Promise((resolve) => {
    const dockerArgs = [
      'exec', '-i', '--user', '10001:10001', '-w', cwd,
      '-e', 'HOME=/home/sandbox', '-e', 'CARGO_HOME=/work/cargo', '-e', 'CARGO_TARGET_DIR=/work/target',
      '-e', `PATH=${execPath}`,
      container, ...args,
    ];
    const child = spawn(dockerBin, dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'], env: dockerClientEnv() });
    const stdout = boundedCapture(maxBytes, keepTail);
    const stderr = boundedCapture(maxBytes, keepTail);
    const done = (code, stderrText = stderr.text()) => resolve({ code, stdout: stdout.text(), stderr: stderrText, omittedBytes: stdout.omitted + stderr.omitted });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, Math.min(Math.max(1000, timeoutMs), 1_810_000));
    child.stdout.on('data', (c) => stdout.push(c));
    child.stderr.on('data', (c) => stderr.push(c));
    child.on('error', (err) => { clearTimeout(timer); done(127, err.message); });
    child.on('close', (code, sig) => { clearTimeout(timer); done(sig === 'SIGKILL' ? 124 : (code ?? 1)); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// A fixed program run as `node -e <script> <args>` inside the container; no model input is spliced into the script.
export function runProgram(ctx, script, args = [], options = {}) {
  return execInContainer(ctx.dockerBin, ctx.container, [NODE_BIN, '-e', script, ...args.map(String)], options);
}
