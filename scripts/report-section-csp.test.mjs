import test from 'node:test';
import assert from 'node:assert/strict';
import { read, renderV2 } from './report-cards-fixtures.mjs';

test('every generated v2 page carries the CSP nonce and loads nothing from the network', () => {
  const dir = renderV2();
  const pages = ['report.html', 'reviewers.html', 'findings-by-model.html', 'reviewers/cli-claude-opus/report.html', 'reviewers/scripted-baseline/report.html'];
  for (const rel of pages) {
    const html = read(dir, rel);
    const nonce = html.match(/script-src &#39;nonce-([A-Za-z0-9+/=]+)&#39;/)?.[1];
    assert.ok(nonce && nonce.length >= 32, rel);
    for (const tag of html.matchAll(/<(script|style)\b[^>]*>/gi)) assert.ok(tag[0].includes(`nonce="${nonce}"`), `${rel} ${tag[0]}`);
    assert.equal(/ on\w+=/i.test(html), false, rel);
    assert.equal(/javascript:/i.test(html), false, rel);
    assert.equal(/https?:\/\//i.test(html), false, rel);
    assert.equal(html.includes('<script>alert(1)</script>'), false, rel);
  }
});
