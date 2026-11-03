// Fixed Docker control calls of the review-worker supervisor (worker-supervisor.mjs): bounded docker CLI runs,
// the hardened container flags, label-checked cleanup and the terminal attach. No target command API.
import { spawn } from 'node:child_process';
import { LIMITS } from './worker-isolation.mjs';
import { bundleMountArgs } from './worker-isolation-bundle.mjs';

export const IMAGE = /^(?:[a-z0-9][a-z0-9./:_-]*@)?sha256:[a-f0-9]{64}$/;

// Only trusted fixed Docker invocations use this helper; no target command API.
export async function docker(args, { maxBytes = LIMITS.logBytes, timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let size = 0;
    let exceeded = false;
    const timer = setTimeout(() => { exceeded = true; child.kill('SIGKILL'); }, timeoutMs);
    const receive = (target) => (data) => {
      size += data.length;
      if (size > maxBytes) { exceeded = true; child.kill('SIGKILL'); return; }
      target.push(data);
    };
    child.stdout.on('data', receive(out));
    child.stderr.on('data', receive(err));
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (exceeded) { reject(new Error('Docker control command exceeded its byte/deadline budget')); return; }
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}

export async function requireDocker(args, options) {
  const result = await docker(args, options);
  if (result.code !== 0) throw new Error('Docker control operation failed');
  return result;
}

export function security(image, name, label, runtime) {
  if (!IMAGE.test(image)) throw new Error('review runtime requires an immutable image identity');
  const args = ['--pull=never', '--name', name, '--label', `omniswarm.review.job=${label}`, '--network', 'none', '--ipc', 'private', '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--pids-limit', '64', '--memory', '128m', '--cpus', '1', '--log-driver', 'json-file', '--log-opt', 'max-size=1m', '--log-opt', 'max-file=1', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777', '--env', 'HOME=/home/reviewer', '--entrypoint', '/usr/local/bin/node', '--tmpfs', '/home/reviewer:rw,noexec,nosuid,nodev,size=8m,uid=10001,gid=10001,mode=700'];
  return [...args, ...bundleMountArgs(runtime.snapshot)];
}

export async function removeOwned(type, name, label) {
  const result = await docker(type === 'volume'
    ? ['volume', 'inspect', name, '--format', '{{index .Labels "omniswarm.review.job"}}']
    : ['inspect', name, '--format', '{{index .Config.Labels "omniswarm.review.job"}}']);
  if (result.code !== 0) {
    if (/no such (container|object|volume)/i.test(result.stderr)) return;
    throw new Error('Docker cleanup could not be verified');
  }
  if (result.stdout.trim() !== label) throw new Error('refusing cleanup of an unowned Docker resource');
  await requireDocker(type === 'volume' ? ['volume', 'rm', name] : ['rm', '--force', name]);
}

export function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('terminal exchange aborted'), { code: signal.reason?.name === 'TimeoutError' ? 'terminal_timeout' : 'terminal_cancelled' }));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

export function attachTerminal(worker) {
  const child = spawn('docker', ['start', '--attach', '--interactive', worker], { stdio: ['pipe', 'pipe', 'pipe'] });
  let errorBytes = 0;
  const errors = [];
  const closed = new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error('terminal Docker attach failed')));
    child.on('close', (code) => resolve(code));
  });
  closed.catch(() => {});
  child.stdin.on('error', () => {});
  child.stderr.on('data', (chunk) => {
    errorBytes += chunk.length;
    if (errorBytes > LIMITS.logBytes) child.kill('SIGKILL');
    else errors.push(chunk);
  });
  return { child, closed, errors: () => Buffer.concat(errors).toString('utf8') };
}
