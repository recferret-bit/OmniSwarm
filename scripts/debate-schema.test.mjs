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
// debate-round has no minItems on citations (lead change request), so an upheld turn with no citation is refused
// by submit_debate_turn instead: see bridge-tools-debate-roles.test.mjs.
