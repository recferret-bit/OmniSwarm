import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));

function renderV2() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-csp-'));
  const built = spawnSync(process.execPath, [path.join(scripts, 'report-fixtures', 'v2-build.mjs'), dir], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const rendered = spawnSync(process.execPath, [path.join(scripts, 'generate-html-report.mjs'), dir], { encoding: 'utf8' });
  assert.ok(rendered.status === 0 || rendered.status === 2, rendered.stderr);
  return dir;
}

test('every generated v2 page carries the CSP nonce and loads nothing from the network', () => {
  const dir = renderV2();
  const pages = ['report.html', 'reviewers.html', 'findings-by-model.html', 'reviewers/cli-claude-opus/report.html'];
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(dir, rel), 'utf8');
    assert.match(html, /script-src &#39;nonce-/, rel);
    for (const tag of html.matchAll(/<(script|style)\b[^>]*>/gi)) {
      assert.match(tag[0], /\bnonce="/, `${rel} ${tag[0]}`);
    }
    assert.equal(/ on\w+=/i.test(html), false, rel);
    assert.equal(/javascript:/i.test(html), false, rel);
    assert.equal(/https?:\/\//i.test(html), false, rel);
    assert.equal(html.includes('<script>alert(1)</script>'), false, rel);
  }
});
