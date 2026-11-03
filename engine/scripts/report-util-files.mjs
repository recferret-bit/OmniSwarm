// Report-directory file helpers for the debate and report modules. Writes go through report-files.mjs'
// atomic writeReportFile; reads are size-capped because report dirs hold target-influenced data.
import fs from 'node:fs';
import path from 'node:path';
import { readReportJson, writeReportFile } from './report-files.mjs';

export function writeText(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeReportFile(root, rel, text);
}

export function writeJson(root, rel, value) {
  writeText(root, rel, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJsonOr(root, rel, fallback, maxBytes) {
  try { return readReportJson(root, rel, maxBytes); } catch { return fallback; }
}

// Run output lives in reports/ at the repository root (engine/scripts/../../reports), beside bin/audit.
export const REPORTS_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..', 'reports');

// Newest directory under reports/ that contains `marker` (a file or folder name), or null.
export function newestReportDir(marker, root = REPORTS_ROOT) {
  if (!fs.existsSync(root)) return null;
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, marker)))
    .map((d) => ({ dir: path.join(root, d.name), mtime: fs.statSync(path.join(root, d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.dir || null;
}

export function listJsonFiles(root, rel) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((name) => readJsonOr(root, `${rel}/${name}`, null)).filter(Boolean);
}
