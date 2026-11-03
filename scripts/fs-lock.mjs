// Cross-process exclusive lock for a short read-modify-write of one report file.
// The lock is an O_EXCL file next to the target holding the owner's pid and start time. A lock whose owner
// process is gone, or that is older than staleMs, is broken; every holder releases in `finally`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

function ownerAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function staleLock(lockFile, staleMs) {
  let stat, owner;
  try { stat = fs.lstatSync(lockFile); owner = JSON.parse(fs.readFileSync(lockFile, 'utf8')); }
  catch { return false; } // released meanwhile, or still being written
  if (!stat.isFile()) throw new Error('lock path is not a regular file');
  return !ownerAlive(owner?.pid) || Date.now() - stat.mtimeMs > staleMs;
}

function breakLock(lockFile) {
  // Rename first so two breakers cannot both delete a lock that a third process just took.
  const aside = `${lockFile}.stale-${crypto.randomBytes(4).toString('hex')}`;
  try { fs.renameSync(lockFile, aside); fs.rmSync(aside, { force: true }); } catch { /* another process broke it */ }
}

function tryAcquire(lockFile) {
  try {
    const fd = fs.openSync(lockFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export async function withFileLock(lockFile, run, { waitMs = 30_000, staleMs = 10_000 } = {}) {
  const started = Date.now();
  while (!tryAcquire(lockFile)) {
    if (staleLock(lockFile, staleMs)) { breakLock(lockFile); continue; }
    if (Date.now() - started > waitMs) throw new Error(`timed out waiting for lock ${lockFile}`);
    await delay(5 + Math.floor(Math.random() * 10));
  }
  try { return await run(); }
  finally { fs.rmSync(lockFile, { force: true }); }
}
