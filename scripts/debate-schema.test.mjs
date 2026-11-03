import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../packages/schemas/index.mjs';

const turn = { round: 1, clusterId: 'CLUSTER-1', role: 'challenge', anonId: 'Reviewer A', verdict: 'upheld', citations: [{ file: 'src/lib.rs', startLine: 1, endLine: 1, quote: 'x' }], argument: 'cited' };
const general = { executiveSummary: 'x', riskPosture: 'moderate', topFindings: [], coverage: [], openDisagreements: [], contributions: [], methodology: { reviewers: [], orchestrator: 'x', passes: 1, toolBudget: 1, debateRounds: 1 }, disclaimer: 'Model agreement and passing checks do not certify security.' };

test('debate fixtures pass and the named bad cases fail with a named error', () => {
  assert.equal(validate('debate-round', turn).ok, true);
  assert.deepEqual(validate('debate-round', { ...turn, round: 4 }).errors, ['$.round: above maximum 3']);
  assert.match(validate('debate-round', { ...turn, citations: [{ file: 'src/lib.rs' }] }).errors[0], /citations\[0\]: missing required "startLine"/);
  assert.equal(validate('general-review', general).ok, true);
  assert.match(validate('general-review', { ...general, riskPosture: 'secure' }).errors[0], /^\$\.riskPosture: must be one of/);
});

test('a turn needs a citation unless it answers insufficient_evidence', () => {
  for (const verdict of ['upheld', 'partial', 'refuted']) {
    assert.deepEqual(validate('debate-round', { ...turn, verdict, citations: [] }).errors, ['$.citations: fewer than 1 items'], verdict);
  }
  assert.equal(validate('debate-round', { ...turn, verdict: 'insufficient_evidence', citations: [] }).ok, true);
});

test('a contribution with no priced pass has costUsd null; a negative cost is refused', () => {
  const row = { reviewerId: 'cli-claude-opus', uniqueConfirmed: 0, refuted: 0, toolCalls: 3, costUsd: null };
  assert.equal(validate('general-review', { ...general, contributions: [row] }).ok, true);
  assert.deepEqual(validate('general-review', { ...general, contributions: [{ ...row, costUsd: -0.5 }] }).errors, ['$.contributions[0].costUsd: below minimum 0']);
});
