import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUS_COLORS } from './report-sections/registry.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));

function channel(hex, index) {
  const value = parseInt(hex.slice(index, index + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrast(fg, bg) {
  const lum = (hex) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

function headings(html) {
  return [...html.matchAll(/<h([1-4])\b/g)].map((match) => Number(match[1]));
}

test('status pill tokens meet WCAG AA contrast on their background', () => {
  for (const [token, color] of Object.entries(STATUS_COLORS)) {
    const ratio = contrast(color.fg, color.bg);
    assert.ok(ratio >= 4.5, `${token} contrast ${ratio.toFixed(2)}`);
  }
});

test('v2 pages have one main, disclosure state, and heading levels without skips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-a11y-'));
  const built = spawnSync(process.execPath, [path.join(scripts, 'report-fixtures', 'v2-build.mjs'), dir], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const rendered = spawnSync(process.execPath, [path.join(scripts, 'generate-html-report.mjs'), dir], { encoding: 'utf8' });
  assert.ok(rendered.status === 0 || rendered.status === 2, rendered.stderr);
  for (const rel of ['report.html', 'reviewers.html', 'findings-by-model.html', 'reviewers/key-zai-glm-5-3/report.html']) {
    const html = fs.readFileSync(path.join(dir, rel), 'utf8');
    assert.equal(html.match(/<main\b/g).length, 1, rel);
    const levels = headings(html);
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1, `${rel} h${levels[i - 1]} to h${levels[i]}`);
  }
  const report = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.match(report, /<details class="disclosure debate"[^>]*aria-expanded="false"/);
  assert.match(report, /data-cross-filter="DISPUTED"[^>]*aria-pressed="false"/);
  const index = fs.readFileSync(path.join(dir, 'reviewers.html'), 'utf8');
  assert.match(index, /aria-label="cli · anthropic/);
});
