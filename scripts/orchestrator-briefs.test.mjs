import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_HEADINGS, briefIds, renderBrief } from './orchestrator-briefs.mjs';

test('every brief has the four headings', () => {
  assert.equal(briefIds().length, 8);
  for (const id of briefIds()) {
    const text = renderBrief(id, { budget: 12 });
    for (const heading of BRIEF_HEADINGS) assert.match(text, new RegExp(`## ${heading}`));
  }
});
