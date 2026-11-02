import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(scripts, 'report-fixtures', 'legacy-run');
const snapshotDir = path.join(scripts, 'report-fixtures', '__snapshots__');
const snapshot = path.join(snapshotDir, 'legacy-report.html');

export function normalizeReportHtml(html) {
  return html
    .replace(/nonce-[A-Za-z0-9+/=]+/g, 'nonce-NONCE')
    .replace(/nonce="[^"]*"/g, 'nonce="NONCE"')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, 'TIMESTAMP');
}

function renderLegacy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-report-'));
  fs.cpSync(fixture, dir, { recursive: true });
  const result = spawnSync(process.execPath, [path.join(scripts, 'generate-html-report.mjs'), dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
}

test('a pre-v2 run matches the stored snapshot apart from the nonce and timestamps', () => {
  const html = normalizeReportHtml(renderLegacy());
  if (process.env.UPDATE_SNAPSHOTS === '1') {
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(snapshot, html);
  }
  assert.equal(fs.existsSync(snapshot), true, 'missing snapshot; rerun with UPDATE_SNAPSHOTS=1');
  const stored = fs.readFileSync(snapshot, 'utf8');
  assert.equal(html, stored);
  assert.equal(html.includes('Cross-check'), false);
  assert.equal(html.includes('General review'), false);
});
