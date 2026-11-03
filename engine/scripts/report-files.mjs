// Bounded, link-refusing reads and atomic writes inside one report directory. Report directories hold
// target-influenced data, so every read is size-capped and every path must stay under the root.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_REPORT_BYTES = 4 * 1024 * 1024;

function reportPath(root, rel) {
  const base = fs.realpathSync(root);
  const file = path.resolve(base, rel);
  if (!file.startsWith(`${base}${path.sep}`)) throw new Error('report path outside root');
  const parent = fs.realpathSync(path.dirname(file));
  if (parent !== base && !parent.startsWith(`${base}${path.sep}`)) throw new Error('report parent outside root');
  return file;
}

export function readReportText(root, rel, max = MAX_REPORT_BYTES) {
  const fd = fs.openSync(reportPath(root, rel), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error('report must be a bounded, singly linked regular file');
    const chunks = [];
    const buf = Buffer.alloc(64 * 1024);
    let total = 0;
    while (total <= max) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, max + 1 - total), null);
      if (!n) return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
      total += n;
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    throw new Error('report grew beyond the byte limit');
  } finally {
    fs.closeSync(fd);
  }
}

export function readReportJson(root, rel, max = MAX_REPORT_BYTES) {
  return JSON.parse(readReportText(root, rel, max));
}

// Atomic: the bytes go to a private temp file in the same directory, then rename over the target (R-13).
// A crash leaves the old file or the new file, never a truncated one. An existing target must be a
// singly linked regular file; a symlink or hard link there is refused and never followed.
export function writeReportFile(root, rel, value) {
  const bytes = Buffer.from(value);
  if (bytes.length > 64 * 1024 * 1024) throw new Error('derived report exceeds byte limit');
  const target = reportPath(root, rel);
  let existing = null;
  try { existing = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (!existing.isFile() || existing.nlink !== 1)) throw new Error('report output must be a singly linked regular file');
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  try { fs.renameSync(temp, target); }
  catch (error) { fs.rmSync(temp, { force: true }); throw error; }
}
