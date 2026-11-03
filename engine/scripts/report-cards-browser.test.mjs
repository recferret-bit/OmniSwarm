import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMatches, installPage, installReport, browserScript } from './report-cards-browser.mjs';
import { read, renderV2 } from './report-cards-fixtures.mjs';

// A small stand-in for the DOM, built from the rendered page: enough for the script's selectors and events.
function element(attrs = {}, text = '') {
  const listeners = {};
  const attributes = { ...attrs };
  const dataset = Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
  return {
    attributes, dataset, hidden: false, open: false, value: '', textContent: text, tagName: 'DETAILS',
    classList: { toggle() {} }, setAttribute(k, v) { attributes[k] = v; }, getAttribute(k) { return attributes[k] ?? null; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, fire(type) { (listeners[type] || []).forEach((fn) => fn()); }, scrollIntoView() {},
  };
}
const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function fakeDocument(html) {
  const cardTags = [...html.matchAll(/<details id="finding-[^>]*class="finding [^>]*>/g)];
  const cards = cardTags.map((m, i) => element(attrsOf(m[0]), strip(html.slice(m.index, cardTags[i + 1]?.index ?? html.indexOf('id="empty-results"')))));
  const buttons = (name) => [...html.matchAll(new RegExp(`<button[^>]*${name}="[^"]*"[^>]*>`, 'g'))].map((m) => element(attrsOf(m[0])));
  const groups = { '.finding': cards, details: cards, '[data-filter]': buttons('data-filter'), '[data-surface-filter]': buttons('data-surface-filter'), '[data-status-filter]': buttons('data-status-filter'), '[data-cross-filter]': buttons('data-cross-filter'), '#crosscheck tbody tr': [] };
  const singles = Object.fromEntries(['#search-box', '[data-reviewer-filter]', '#results-count', '#empty-results', '#reset-filters', '#expand-all', '#findings'].map((sel) => [sel, element()]));
  return { cards, groups, singles, doc: { querySelectorAll: (sel) => groups[sel] || [], querySelector: (sel) => singles[sel] || null, getElementById: () => null } };
}

const win = { location: { hash: '' }, addEventListener() {} };
const visible = (cards) => cards.filter((card) => !card.hidden).map((card) => card.attributes.id);

test('cardMatches combines severity, surface, status, reviewer and search', () => {
  const card = { severity: 'info', surface: 'S1', status: 'LIKELY', reviewers: ['key-zai-glm-5-3-s1-auth'], text: 'logged secret in src/log.ts' };
  const all = { severity: 'all', surface: 'all', status: '', reviewer: '', query: '' };
  assert.equal(cardMatches(card, all), true);
  assert.equal(cardMatches(card, { ...all, severity: 'low' }), true);
  assert.equal(cardMatches(card, { ...all, severity: 'high' }), false);
  assert.equal(cardMatches(card, { ...all, status: 'LIKELY', reviewer: 'key-zai-glm-5-3', query: 'log.ts' }), true);
  assert.equal(cardMatches(card, { ...all, reviewer: 'key-zai' }), false);
  assert.equal(cardMatches(card, { ...all, query: 'withdraw' }), false);
  assert.match(browserScript(), /^\(function installReport\(doc, matches\)[\s\S]*\(function installPage\(doc, win\)/);
});

test('on the rendered report the filters, status chips, reviewer select and search narrow the same list', () => {
  const html = read(renderV2(), 'report.html');
  const { cards, groups, singles, doc } = fakeDocument(html);
  installReport(doc, cardMatches);
  installPage(doc, win);
  assert.equal(visible(cards).length, 4);
  groups['[data-filter]'].find((b) => b.dataset.filter === 'high').fire('click');
  assert.deepEqual(visible(cards), ['finding-CLUSTER-1']);
  groups['[data-filter]'].find((b) => b.dataset.filter === 'all').fire('click');
  groups['[data-status-filter]'].find((b) => b.dataset.statusFilter === 'LIKELY').fire('click');
  assert.deepEqual(visible(cards), ['finding-CLUSTER-4']);
  singles['[data-reviewer-filter]'].value = 'cli-claude-opus';
  singles['[data-reviewer-filter]'].fire('change');
  assert.deepEqual(visible(cards), []);
  assert.equal(singles['#empty-results'].hidden, false);
  groups['[data-status-filter]'].find((b) => b.dataset.statusFilter === 'LIKELY').fire('click');
  assert.deepEqual(visible(cards).sort(), ['finding-CLUSTER-1', 'finding-CLUSTER-3']);
  singles['#search-box'].value = 'reviewer d';
  singles['#search-box'].fire('input');
  assert.deepEqual(visible(cards), ['finding-CLUSTER-1'], 'search covers the debate text');
  singles['#reset-filters'].fire('click');
  assert.equal(visible(cards).length, 4);
  assert.equal(singles['#results-count'].textContent, '4 / 4 findings');
});

test('a reviewer page has a working severity filter and search', () => {
  const html = read(renderV2(), 'reviewers/cli-claude-opus/report.html');
  const { cards, groups, singles, doc } = fakeDocument(html);
  installReport(doc, cardMatches);
  installPage(doc, win);
  assert.equal(cards.length, 2);
  groups['[data-filter]'].find((b) => b.dataset.filter === 'low').fire('click');
  assert.equal(visible(cards).length, 1);
  singles['#search-box'].value = 'owner';
  singles['#search-box'].fire('input');
  assert.equal(visible(cards).length, 0);
  assert.equal(singles['#results-count'].textContent, '0 / 2 findings');
});
