import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../shared/schemas/index.mjs';

test('debate fixtures pass and the named bad cases fail', () => {
  const turn = { round: 1, clusterId: 'CLUSTER-1', role: 'challenge', anonId: 'Reviewer A', verdict: 'upheld', citations: [{ file: 'src/lib.rs', startLine: 1, endLine: 1, quote: 'x' }], argument: 'cited' };
  assert.equal(validate('debate-round', turn).ok, true);
  assert.equal(validate('debate-round', { ...turn, round: 4 }).ok, false);
  assert.equal(validate('general-review', { executiveSummary: 'x', riskPosture: 'secure', topFindings: [], coverage: [], openDisagreements: [], contributions: [], methodology: { reviewers: [], orchestrator: 'x', passes: 1, toolBudget: 1, debateRounds: 1 }, disclaimer: 'Model agreement and passing checks do not certify security.' }).ok, false);
});
