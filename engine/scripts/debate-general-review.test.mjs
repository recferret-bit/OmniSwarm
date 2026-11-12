import test from 'node:test';
import assert from 'node:assert/strict';
import { countSentence, rulesSummary } from './debate-general-review.mjs';

const rows = (n, finalStatus, severity, agreed = false) => Array.from({ length: n }, () => ({ finalStatus, severity, agreed }));

test('the count sentence is computed from the adjudication rows', () => {
  // The shape of a real four-reviewer run: 10 clusters confirmed by agreement, 2 by a judge, 31 rules-only LIKELY.
  const adjudicated = [
    ...rows(4, 'CONFIRMED', 'medium', true), ...rows(6, 'CONFIRMED', 'low', true),
    ...rows(1, 'CONFIRMED', 'medium'), ...rows(1, 'CONFIRMED', 'low'),
    ...rows(9, 'LIKELY', 'medium'), ...rows(16, 'LIKELY', 'low'), ...rows(6, 'LIKELY', 'info'),
  ];
  assert.equal(countSentence(adjudicated), 'Adjudicated: 43 clusters, 12 CONFIRMED (10 by model agreement, 2 by a judge), 31 LIKELY; by severity 14 medium, 23 low, 6 info.');
  assert.equal(countSentence(rows(1, 'REFUTED', 'high')), 'Adjudicated: 1 cluster, 1 REFUTED; by severity 1 high.');
  assert.equal(countSentence([]), 'Adjudicated: 0 clusters.');
});

test('a rules summary is marked as already carrying its counts', () => {
  assert.equal(rulesSummary(rows(2, 'LIKELY', 'low')).computed, true);
  assert.equal(rulesSummary([]).computed, true);
  assert.equal(rulesSummary(rows(1, 'DISPUTED', 'low'), { fallbackReason: 'debate_turn_timeout' }).computed, true);
});
