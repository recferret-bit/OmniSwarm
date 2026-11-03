// Process execution for the in-container checks: a bounded run with its full output spilled to /out,
// the per-check logs, and the result classifiers the checks share.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { osvOfflineMiss, safeRel } from './sandbox-lib.mjs';
import { outDir, timeLeft } from './sandbox-inside-state.mjs';

let spillSeq = 0;
const spills = new Set();
const LOG_CAP = 32 * 1024 * 1024;

export const CARGO_ENV = {
  CARGO_TARGET_DIR: '/work/target',
  CARGO_HOME: '/work/cargo',
  OPENSSL_NO_VENDOR: '1',
};
export const OPENSSL_NOTE = 'OpenSSL build scripts used the image library. The upstream tarball was not fetched.';

// Appends one chunk to the spill file, cut at LOG_CAP with a marker.
function spillWriter(spillFd) {
  let spilled = 0;
  let capped = false;
  return (buf) => {
    if (spillFd == null || capped) return;
    if (spilled + buf.length > LOG_CAP) {
      const room = LOG_CAP - spilled;
      if (room > 0) {
        fs.writeSync(spillFd, buf.subarray(0, room));
        spilled += room;
      }
      fs.writeSync(spillFd, '\n[truncated at 32MB]\n');
      capped = true;
      return;
    }
    fs.writeSync(spillFd, buf);
    spilled += buf.length;
  };
}

export function run(cmd, args, { cwd, timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: cwd || '/work/src',
      env: { ...process.env, PATH: `/work/bin:${process.env.PATH || ''}`, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const spill = path.join(outDir, `.spill-${process.pid}-${spillSeq++}`);
    let spillFd = null;
    try {
      spillFd = fs.openSync(spill, 'w');
      spills.add(spill);
    } catch { spillFd = null; }
    const write = spillWriter(spillFd);
    const take = (buf) => {
      out = (out + buf.toString()).slice(-16_000);
      write(buf);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const limit = Math.max(1000, Math.min(timeoutMs || timeLeft(), timeLeft()));
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, limit);
    const finishRun = (code) => {
      if (spillFd != null) { try { fs.closeSync(spillFd); } catch { /* already closed */ } }
      resolve({ code, out, spill: spillFd != null ? spill : null });
    };
    child.on('error', (err) => {
      clearTimeout(timer);
      out = err.message;
      finishRun(127);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      finishRun(signal === 'SIGKILL' ? 124 : (code ?? 1));
    });
  });
}

export function brief(res) {
  const tail = res.out.trim().split('\n').slice(-2).join(' ').slice(0, 220);
  const why = res.code === 124 ? 'timed out' : `exit ${res.code}`;
  return tail ? `${why}: ${tail}` : why;
}

export function sweepSpills() {
  for (const file of spills) fs.rmSync(file, { force: true });
  spills.clear();
}

export function log(id, res) {
  const file = path.join(outDir, `${id}.log`);
  fs.appendFileSync(file, `\n--- ${id}\n`);
  if (res.spill && spills.has(res.spill)) {
    const inFd = fs.openSync(res.spill, 'r');
    const outFd = fs.openSync(file, 'a');
    const buf = Buffer.alloc(256 * 1024);
    let n;
    while ((n = fs.readSync(inFd, buf, 0, buf.length, null)) > 0) fs.writeSync(outFd, buf, 0, n);
    fs.closeSync(inFd);
    fs.closeSync(outFd);
    fs.rmSync(res.spill, { force: true });
    spills.delete(res.spill);
  } else if (res.out) {
    fs.appendFileSync(file, res.out);
  }
  try { fs.chmodSync(file, 0o644); } catch { /* the report dir is already writable by the host */ }
}

export function scanResult(res) {
  if (osvOfflineMiss(res.out) && res.code !== 0 && res.code !== 1) return 'impossible';
  return res.code === 0 || res.code === 1 ? 'ran' : 'failed';
}

export function dirOf(rel) {
  const safe = safeRel(rel);
  if (!safe) return null;
  return safe === '.' ? '/work/src' : path.join('/work/src', safe);
}
