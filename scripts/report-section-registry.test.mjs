import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_LEGEND, loadSections, sectionDescriptors, v2Extras } from './report-sections/registry.mjs';

test('sections sort by filename and the legend lists final and legacy statuses', () => {
  const names = loadSections();
  assert.deepEqual(names, [...names].sort());
  assert.ok(names.includes('crosscheck.mjs'));
  assert.ok(names.includes('general-review.mjs'));
  const described = sectionDescriptors();
  assert.deepEqual(described.map((row) => row.order), [...described].map((row) => row.order).sort((a, b) => a - b));
  assert.equal(STATUS_LEGEND.FINAL.length, 6);
  assert.equal(STATUS_LEGEND.LEGACY.length, 5);
});

test('a legacy directory gets no extra markup', () => {
  const extras = v2Extras('/nonexistent/legacy', (v) => String(v));
  assert.equal(extras.rail, '');
  assert.equal(extras.hero, '');
  assert.equal(extras.sections, '');
  assert.equal(extras.debateHtml({ title: 'x' }), '');
});
