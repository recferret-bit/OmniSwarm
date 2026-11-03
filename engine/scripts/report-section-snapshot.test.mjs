import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { matchSnapshot, read, renderLegacy, renderV2 } from './report-cards-fixtures.mjs';

test('a pre-v2 run matches the stored snapshot apart from the nonce and timestamps', () => {
  const dir = renderLegacy();
  const html = read(dir, 'report.html');
  matchSnapshot('legacy-report.html', html);
  assert.equal(html.includes('Cross-check'), false);
  assert.equal(html.includes('General review'), false);
  assert.equal(fs.existsSync(path.join(dir, 'reviewers')), false);
});

test('the five v2 pages match their snapshots', () => {
  const dir = renderV2();
  matchSnapshot('v2-report.html', read(dir, 'report.html'));
  matchSnapshot('v2-findings-by-model.html', read(dir, 'findings-by-model.html'));
  matchSnapshot('v2-reviewers.html', read(dir, 'reviewers.html'));
  matchSnapshot('v2-reviewer-key-zai-glm-5-3.html', read(dir, 'reviewers/key-zai-glm-5-3/report.html'));
  const gap = renderV2({ before: (d) => fs.rmSync(path.join(d, 'general-review.json')) });
  matchSnapshot('v2-report-no-general-review.html', read(gap, 'report.html'));
});

test('two renders of the same run use different CSP nonces on every page', () => {
  const nonces = (dir, rel) => read(dir, rel).match(/nonce-([A-Za-z0-9+/=]+)/)[1];
  const [a, b] = [renderV2(), renderV2()];
  for (const rel of ['report.html', 'reviewers.html', 'reviewers/cli-claude-opus/report.html']) assert.notEqual(nonces(a, rel), nonces(b, rel), rel);
});
