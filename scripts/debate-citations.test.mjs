import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCitation } from './debate-citations.mjs';

test('quotes match after whitespace folding and reject escapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cite-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'lib.rs'), 'fn withdraw() {\n    self.balance = self.balance.saturating_sub(amount);\n}\n');
  const quote = 'self.balance   = self.balance.saturating_sub(amount);';
  assert.equal(checkCitation(root, { file: 'src/lib.rs', startLine: 2, endLine: 2, quote }).valid, true);
  assert.equal(checkCitation(root, { file: 'src/lib.rs', startLine: 12, endLine: 12, quote }).reason, 'quote_not_found');
  assert.equal(checkCitation(root, { file: '../etc/passwd', startLine: 1, endLine: 1, quote: 'x' }).reason, 'path_outside_snapshot');
});
