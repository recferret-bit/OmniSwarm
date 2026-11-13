// Publish (W09-10): copy one attempt's report into REPORTS_ROOT/<requestId>/ without private files,
// make it read-only, write published.json, and move it into place with a single rename. The first
// publication wins: a later attempt never replaces a report that may already be linked.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashReportDir } from './report.ts';

const EXCLUDED_DIRS = new Set(['sessions', 'harness']);
const EXCLUDED_FILE = /\.log$/;

export interface Published { dir: string; reportSha256: string; created: boolean }
export interface PublishInput { reportsRoot: string; requestId: string; sourceDir: string; repo: string; commitSha: string; preset: string }

function copyTree(from: string, to: string, rel = ''): string[] {
  fs.mkdirSync(path.join(to, rel), { recursive: true });
  const files: string[] = [];
  for (const entry of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory() && !(rel === '' && EXCLUDED_DIRS.has(entry.name))) files.push(...copyTree(from, to, child));
    else if (entry.isFile() && !EXCLUDED_FILE.test(entry.name)) {
      fs.copyFileSync(path.join(from, child), path.join(to, child));
      files.push(child.split(path.sep).join('/'));
    }
    // Symlinks and other special files are never published.
  }
  return files;
}

function setModes(dir: string, includeRoot: boolean): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) setModes(child, true);
    else fs.chmodSync(child, 0o444);
  }
  if (includeRoot) fs.chmodSync(dir, 0o555);
}

/** Remove a published (0555/0444) tree: every directory is made writable before anything below it goes. */
export function removeTree(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const unlock = (current: string) => {
    fs.chmodSync(current, 0o755);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) unlock(path.join(current, entry.name));
    }
  };
  unlock(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function readPublished(reportsRoot: string, requestId: string): (Published & { files: string[] }) | null {
  const dir = path.join(reportsRoot, requestId);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'published.json'), 'utf8')) as { reportSha256?: string; files?: unknown };
    const files = Array.isArray(manifest.files) ? manifest.files.filter((file): file is string => typeof file === 'string') : [];
    return manifest.reportSha256 ? { dir, reportSha256: manifest.reportSha256, created: false, files } : null;
  } catch {
    return null;
  }
}

export function publishReport(input: PublishInput): Published {
  const existing = readPublished(input.reportsRoot, input.requestId);
  if (existing) return existing;
  const staging = path.join(input.reportsRoot, '.staging', `${input.requestId}-${crypto.randomBytes(6).toString('hex')}`);
  const files = copyTree(input.sourceDir, staging);
  const reportSha256 = hashReportDir(staging);
  const manifest = { requestId: input.requestId, repo: input.repo, commitSha: input.commitSha, preset: input.preset, reportSha256, files: files.sort() };
  fs.writeFileSync(path.join(staging, 'published.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  setModes(staging, false);
  const target = path.join(input.reportsRoot, input.requestId);
  try {
    fs.renameSync(staging, target);
  } catch (error) {
    removeTree(staging);
    const winner = readPublished(input.reportsRoot, input.requestId);
    if (winner) return winner;
    throw error;
  }
  fs.chmodSync(target, 0o555);
  return { dir: target, reportSha256, created: true };
}
