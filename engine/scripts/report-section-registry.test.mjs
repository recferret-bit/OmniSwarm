import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STATUS_LEGEND, loadSections, loadV2, sectionDescriptors } from './report-section-registry.mjs';
import { citationState } from './report-section-v2-data.mjs';
import { read, renderV2 } from './report-cards-fixtures.mjs';

test('sections are discovered from their files, sorted by order, and each one that renders owns render()', () => {
  const names = loadSections();
  assert.deepEqual(names, [...names].sort());
  const described = sectionDescriptors();
  assert.deepEqual(described.map((row) => row.order), [...described].map((row) => row.order).sort((a, b) => a - b));
  for (const id of ['overview-general-review', 'status-legend', 'finding-filters', 'finding-debate', 'by-model', 'crosscheck', 'general-review', 'reviewers-index']) {
    const found = described.find((row) => row.id === id);
    assert.ok(found, id);
    if (found.slot) assert.equal(typeof found.render, 'function', id);
  }
});

test('discovery reads the flat report-section-*.mjs modules and never a test file or the registry', () => {
  const names = loadSections();
  assert.ok(names.includes('report-section-by-model.mjs') && names.includes('report-section-v2-data.mjs'), names.join(', '));
  assert.ok(names.every((name) => /^report-section-[a-z0-9-]+\.mjs$/.test(name)), names.join(', '));
  assert.equal(names.some((name) => name.includes('.test.') || name === 'report-section-registry.mjs'), false, names.join(', '));
  assert.equal(fs.existsSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'report-sections')), false, 'no module subfolder under engine/scripts/');
});

test('the legend lists the six final statuses and the five statuses the engine emits', () => {
  assert.deepEqual(STATUS_LEGEND.FINAL, ['AGREED', 'CONFIRMED', 'LIKELY', 'DISPUTED', 'REFUTED', 'INSUFFICIENT_EVIDENCE']);
  assert.deepEqual(STATUS_LEGEND.LEGACY, ['MODEL_AGREEMENT', 'MODEL_ASSERTION', 'UPHELD_REVIEW', 'PARTIAL_REVIEW', 'REFUTED_REVIEW']);
  const engine = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'verify-and-adjudicate.mjs'), 'utf8');
  for (const status of new Set(engine.match(/'[A-Z]+_(?:REVIEW|AGREEMENT|ASSERTION)'/g).map((s) => s.slice(1, -1)))) assert.ok(STATUS_LEGEND.LEGACY.includes(status), status);
  for (const status of [...STATUS_LEGEND.FINAL, ...STATUS_LEGEND.LEGACY]) assert.ok(STATUS_LEGEND.MEANING[status], status);
});

test('a legacy directory gets no v2 at all', () => {
  assert.equal(loadV2('/nonexistent/legacy'), null);
});

test('a citation the checker never recorded is shown as unchecked, not as verified', () => {
  const data = { citations: [{ file: 'a.rs', startLine: 2, quote: 'x', valid: true, clusterId: 'CLUSTER-1', anonId: 'Reviewer A' }] };
  const turn = { clusterId: 'CLUSTER-1', anonId: 'Reviewer A' };
  assert.deepEqual(citationState(data, turn, { file: 'a.rs', startLine: 2, quote: 'x' }), { valid: true });
  assert.deepEqual(citationState(data, turn, { file: 'a.rs', startLine: 3, quote: 'x' }), { valid: false, reason: 'unchecked' });
  assert.deepEqual(citationState(data, { ...turn, anonId: 'Reviewer B' }, { file: 'a.rs', startLine: 2, quote: 'x' }), { valid: false, reason: 'unchecked' });
});

test('cards read finalStatus from findings-and-scores and join their debate by claim id', () => {
  const dir = renderV2();
  const html = read(dir, 'report.html');
  const card = (title) => {
    const at = html.indexOf(`<h3>${title}</h3>`);
    const next = html.indexOf('<details id="finding-', at);
    return html.slice(html.lastIndexOf('<details id="finding-', at), next === -1 ? html.indexOf('id="empty-results"') : next);
  };
  assert.match(card('Missing owner check'), /<details id="finding-CLUSTER-1"[^>]*data-status="DISPUTED"/);
  assert.match(card('Missing owner check'), /<span class="pill orange" data-status="DISPUTED">DISPUTED<\/span>/);
  assert.match(card('Missing owner check'), /<summary>Debate<\/summary>/);
  assert.match(card('Agreed check'), /data-status="AGREED"/);
  assert.match(card('Agreed check'), /AGREED at triage/);
  assert.equal(card('Agreed check').includes('round 1'), false);
  assert.match(card('Unchecked arithmetic'), /<span class="pill">partial review<\/span>/);
  assert.equal(card('Unchecked arithmetic').includes('<summary>Debate</summary>'), false);
});
