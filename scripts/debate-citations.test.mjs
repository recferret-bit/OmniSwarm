import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { anchorEvidence, checkCitation, checkTurnCitations, sourceReader } from './debate-citations.mjs';
import { sourceTree } from './debate-test-run.mjs';

const BODY = 'fn withdraw() {\n\tself.balance = self.balance.saturating_sub(amount);\n}\n\nfn other() {\n    guard();\n}\n';

test('quotes match after whitespace and tab folding and reject escapes', () => {
  const reader = sourceReader(sourceTree({ 'src/lib.rs': BODY }));
  const quote = 'self.balance   = self.balance.saturating_sub(amount);';
  assert.equal(checkCitation(reader, { file: 'src/lib.rs', startLine: 2, endLine: 2, quote }).valid, true);
  assert.equal(checkCitation(reader, { file: 'src/lib.rs', startLine: 1, endLine: 3, quote: 'withdraw() { self.balance' }).valid, true);
  assert.equal(checkCitation(reader, { file: 'src/lib.rs', startLine: 12, endLine: 12, quote }).reason, 'line_out_of_range');
  assert.equal(checkCitation(reader, { file: 'src/lib.rs', startLine: 1, endLine: 1, quote }).reason, 'quote_not_found');
  assert.equal(checkCitation(reader, { file: '../etc/passwd', startLine: 1, endLine: 1, quote: 'x' }).reason, 'path_outside_snapshot');
  assert.equal(checkCitation(reader, { file: 'src/none.rs', startLine: 1, endLine: 1, quote: 'x' }).reason, 'file_not_in_snapshot');
});

test('a file that changed after the snapshot manifest is refused', () => {
  const root = sourceTree({ 'src/lib.rs': BODY });
  const sha = crypto.createHash('sha256').update(BODY).digest('hex');
  const sealed = sourceReader(root, { files: [{ path: 'src/lib.rs', sha256: sha }] });
  assert.equal(anchorEvidence(sealed, { file: 'src/lib.rs', line: 2 }).valid, true);
  fs.appendFileSync(path.join(root, 'src/lib.rs'), '// edited\n');
  assert.equal(anchorEvidence(sourceReader(root, { files: [{ path: 'src/lib.rs', sha256: sha }] }), { file: 'src/lib.rs', line: 2 }).reason, 'source_changed');
});

test('a blank line or a lone brace is not evidence', () => {
  const reader = sourceReader(sourceTree({ 'src/lib.rs': BODY }));
  assert.equal(anchorEvidence(reader, { file: 'src/lib.rs', line: 3 }).reason, 'not_evidence');
  assert.equal(anchorEvidence(reader, { file: 'src/lib.rs', line: 4 }).reason, 'not_evidence');
});

test('a valid quote far from the cluster does not count for it', () => {
  const reader = sourceReader(sourceTree({ 'src/lib.rs': BODY }));
  const far = { file: 'src/lib.rs', startLine: 6, endLine: 6, quote: 'guard();' };
  const near = { file: 'src/lib.rs', startLine: 2, endLine: 2, quote: 'saturating_sub' };
  const [a, b] = checkTurnCitations(reader, [far, near], [{ file: 'src/lib.rs', line: 1 }]);
  assert.equal(a.reason, 'not_about_this_cluster');
  assert.equal(b.valid, true);
});
