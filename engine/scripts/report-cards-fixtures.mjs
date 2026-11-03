// Test seam (imported by tests only): render the committed report fixtures into a temp directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
export const SNAPSHOTS = path.join(SCRIPTS, 'report-fixtures', '__snapshots__');
const node = (script, args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' });

// build(dir) runs before rendering, e.g. to delete general-review.json.
export function renderV2({ before } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-report-'));
  const built = node('report-fixtures/v2-build.mjs', [dir]);
  assert.equal(built.status, 0, built.stderr);
  before?.(dir);
  const rendered = node('generate-html-report.mjs', [dir]);
  assert.ok(rendered.status === 0 || rendered.status === 2, rendered.stderr);
  return dir;
}

export function renderLegacy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-report-'));
  fs.cpSync(path.join(SCRIPTS, 'report-fixtures', 'legacy-run'), dir, { recursive: true });
  const rendered = node('generate-html-report.mjs', [dir]);
  assert.equal(rendered.status, 0, rendered.stderr);
  return dir;
}

export const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

export function normalizeReportHtml(html) {
  return html
    .replace(/nonce-[A-Za-z0-9+/=]+/g, 'nonce-NONCE')
    .replace(/nonce="[^"]*"/g, 'nonce="NONCE"')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, 'TIMESTAMP');
}

// Compare with the stored snapshot; UPDATE_SNAPSHOTS=1 rewrites it.
export function matchSnapshot(name, html) {
  const file = path.join(SNAPSHOTS, name);
  const normalized = normalizeReportHtml(html);
  if (process.env.UPDATE_SNAPSHOTS === '1') { fs.mkdirSync(SNAPSHOTS, { recursive: true }); fs.writeFileSync(file, normalized); }
  assert.equal(fs.existsSync(file), true, `missing snapshot ${name}; rerun with UPDATE_SNAPSHOTS=1`);
  assert.equal(normalized, fs.readFileSync(file, 'utf8'), `${name} changed; rerun with UPDATE_SNAPSHOTS=1 and review the diff`);
}
