import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBrief } from './review-briefs.mjs';

test('pass 2 names the unread files and the call budget', () => {
  const text = renderBrief({ pass: 2, passes: 2, toolBudget: 40, filesRead: ['a.rs'], files: ['a.rs', 'b.rs'] });
  assert.match(text, /Pass 2 of 2: self-verify/);
  assert.match(text, /40 calls/);
  assert.match(text, /Unread files: b\.rs/);
  assert.match(text, /Submit no finding if none/);
});
