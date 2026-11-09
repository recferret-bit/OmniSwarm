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
  assert.equal(anchorEvidence(sourceReader(root, { files: [] }), { file: 'src/lib.rs', line: 2 }).reason, 'file_not_in_snapshot');
});

test('a blank line or a lone brace is not evidence', () => {
  const reader = sourceReader(sourceTree({ 'src/lib.rs': BODY }));
  assert.equal(anchorEvidence(reader, { file: 'src/lib.rs', line: 3 }).reason, 'not_evidence');
  assert.equal(anchorEvidence(reader, { file: 'src/lib.rs', line: 4 }).reason, 'not_evidence');
});

test('a valid quote far from the cluster does not count for it, while a quote in the same function does', () => {
  const longFn = [
    'fn withdraw() {',
    ...Array.from({ length: 14 }, (_, i) => `    let step_${i} = ${i};`),
    '    self.balance = self.balance.saturating_sub(amount);',
    '}',
    '',
    'fn other() {',
    '    guard();',
    '}',
    '',
  ].join('\n');
  const reader = sourceReader(sourceTree({ 'src/lib.rs': BODY, 'src/long.rs': longFn }));
  const far = { file: 'src/lib.rs', startLine: 6, endLine: 6, quote: 'guard();' };
  const near = { file: 'src/lib.rs', startLine: 2, endLine: 2, quote: 'saturating_sub' };
  const [a, b] = checkTurnCitations(reader, [far, near], [{ file: 'src/lib.rs', line: 1 }]);
  assert.equal(a.reason, 'not_about_this_cluster');
  assert.equal(b.valid, true);
  const sameFn = { file: 'src/long.rs', startLine: 16, endLine: 16, quote: 'saturating_sub' };
  const otherFn = { file: 'src/long.rs', startLine: 20, endLine: 20, quote: 'guard();' };
  const [c, d] = checkTurnCitations(reader, [sameFn, otherFn], [{ file: 'src/long.rs', line: 1 }]);
  assert.equal(c.valid, true);
  assert.equal(d.reason, 'not_about_this_cluster');
});

test('sameFunctionSpan separates TS arrow functions, TS class methods, and Python top-level statements while allowing inner callbacks', () => {
  const tsArrows = [
    'export const withdraw = async (amount: number) => {',
    ...Array.from({ length: 6 }, (_, i) => `  const s${i} = ${i};`),
    '  items.forEach((item) => {',
    '    checkItem(item);',
    '  });',
    '  return balance - amount;',
    '};',
    'export const deposit = async (amount: number) => {',
    '  return balance + amount;',
    '};',
  ].join('\n');
  const tsClass = [
    'export class Vault {',
    '  async withdraw(amount: number): Promise<number> {',
    ...Array.from({ length: 6 }, (_, i) => `    const s${i} = ${i};`),
    '    return this.balance - amount;',
    '  }',
    '  async deposit(amount: number): Promise<number> {',
    '    return this.balance + amount;',
    '  }',
    '}',
  ].join('\n');
  const pyMod = [
    'def withdraw(amount):',
    ...Array.from({ length: 6 }, (_, i) => `    step_${i} = ${i}`),
    '    return balance - amount',
    '',
    'GLOBAL_LIMIT = 100',
  ].join('\n');
  const reader = sourceReader(sourceTree({ 'src/arrows.ts': tsArrows, 'src/class.ts': tsClass, 'src/mod.py': pyMod }));

  const [arrowSame, arrowOther] = checkTurnCitations(reader, [
    { file: 'src/arrows.ts', startLine: 11, endLine: 11, quote: 'return balance - amount;' },
    { file: 'src/arrows.ts', startLine: 14, endLine: 14, quote: 'return balance + amount;' },
  ], [{ file: 'src/arrows.ts', line: 1 }]);
  assert.equal(arrowSame.valid, true, 'citation after inner .forEach callback in same arrow function is accepted');
  assert.equal(arrowOther.reason, 'not_about_this_cluster', 'citation in next arrow function is rejected');

  const [classSame, classOther] = checkTurnCitations(reader, [
    { file: 'src/class.ts', startLine: 9, endLine: 9, quote: 'return this.balance - amount;' },
    { file: 'src/class.ts', startLine: 12, endLine: 12, quote: 'return this.balance + amount;' },
  ], [{ file: 'src/class.ts', line: 2 }]);
  assert.equal(classSame.valid, true, 'citation in same TS class method is accepted');
  assert.equal(classOther.reason, 'not_about_this_cluster', 'citation in adjacent TS class method is rejected');

  const [pySame, pyOther] = checkTurnCitations(reader, [
    { file: 'src/mod.py', startLine: 8, endLine: 8, quote: 'return balance - amount' },
    { file: 'src/mod.py', startLine: 10, endLine: 10, quote: 'GLOBAL_LIMIT = 100' },
  ], [{ file: 'src/mod.py', line: 1 }]);
  assert.equal(pySame.valid, true, 'citation in same Python function is accepted');
  assert.equal(pyOther.reason, 'not_about_this_cluster', 'citation on top-level Python statement after function is rejected');
});
