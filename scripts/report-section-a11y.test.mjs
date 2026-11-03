import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STATUS_COLORS } from './report-sections/registry.mjs';
import { SCRIPTS, read, renderLegacy, renderV2 } from './report-cards-fixtures.mjs';

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

test('status pill tokens and the CSS tone classes meet WCAG AA contrast', () => {
  for (const [token, color] of Object.entries(STATUS_COLORS)) {
    const ratio = contrast(color.fg, color.bg);
    assert.ok(ratio >= 4.5, `${token} contrast ${ratio.toFixed(2)}`);
  }
  const css = fs.readFileSync(path.join(SCRIPTS, 'report-style.css'), 'utf8');
  const vars = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  for (const tone of ['red', 'green', 'blue']) {
    const ratio = contrast(vars[tone], vars[`${tone}-pale`]);
    assert.ok(ratio >= 4.5, `pill ${tone} on ${tone}-pale ${ratio.toFixed(2)}`);
  }
  // Orange pills (medium severity, bundled claim, severity spread) on legacy and v2 pages alike.
  assert.match(css, /^\.pill\.orange \{ color: var\(--orange-ink\); \}$/m);
  assert.ok(contrast(vars['orange-ink'], vars['orange-pale']) >= 4.5, `orange pill text ${contrast(vars['orange-ink'], vars['orange-pale']).toFixed(2)}`);
  assert.ok(read(renderLegacy(), 'report.html').includes('.pill.orange { color: var(--orange-ink); }'), 'legacy pages embed the darker orange pill text');
});

test('v2 pages have one main, native disclosures, pressed state, labelled badges and no heading skips', () => {
  const dir = renderV2();
  for (const rel of ['report.html', 'reviewers.html', 'findings-by-model.html', 'reviewers/key-zai-glm-5-3/report.html']) {
    const html = read(dir, rel);
    assert.equal(html.match(/<main\b/g).length, 1, rel);
    const levels = headings(html);
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1, `${rel} h${levels[i - 1]} to h${levels[i]}`);
    assert.equal(/<details[^>]*aria-expanded/.test(html), false, `${rel}: a static aria-expanded on <details> goes stale`);
  }
  const report = read(dir, 'report.html');
  assert.match(report, /<details class="disclosure debate"><summary>Debate<\/summary>/);
  assert.match(report, /data-cross-filter="DISPUTED"[^>]*aria-pressed="false"/);
  assert.match(report, /data-status-filter="LIKELY"[^>]*aria-pressed="false"/);
  assert.match(read(dir, 'reviewers.html'), /aria-label="cli · anthropic · opus"/);
  assert.match(read(dir, 'reviewers.html'), /<span class="pill" aria-label="openrouter · alibaba · qwen\/qwen3\.8-max-0902">openrouter · alibaba · qwen\/qwen3\.8-max-0902<\/span>/);
});
