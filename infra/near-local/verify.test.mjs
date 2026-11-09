import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { b58encode } from '../../packages/schemas/nep413.mjs';
import { codeHashOf, compareCodeHash, formatVerify, parseVerifyArgs, verifyCommand } from './verify.mjs';

test('code_hash is the base58 sha256 of the wasm bytes', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const digest = createHash('sha256').update(bytes).digest();
  assert.equal(codeHashOf(bytes), b58encode(digest));
  assert.equal(compareCodeHash(codeHashOf(bytes), codeHashOf(bytes)), 'match');
  assert.equal(compareCodeHash('11111111111111111111111111111111', codeHashOf(bytes)), 'drift');
});

test('verify prints match, then drift with both hashes', async () => {
  const wasm = 'contracts/review-registry/res/review_registry.wasm';
  const bytes = new Uint8Array([9, 9, 9, 9]);
  const hash = codeHashOf(bytes);
  // The command reads the real wasm file. Compare against a stand-in query.
  const lines = [];
  const verdict = await verifyCommand(['registry'], {
    query: async (accountId) => {
      assert.equal(accountId, 'registry.test.near');
      const file = new Uint8Array((await import('node:fs')).readFileSync(new URL('../../contracts/review-registry/res/review_registry.wasm', import.meta.url)));
      return codeHashOf(file);
    },
    stdout: (text) => lines.push(text),
  });
  assert.equal(verdict, 'match');
  assert.match(lines[0], new RegExp(`code_hash .+ == sha256\\(${wasm}\\) → match`));

  lines.length = 0;
  const drifted = await verifyCommand(['registry', '--wasm', wasm], {
    query: async () => hash,
    stdout: (text) => lines.push(text),
  });
  assert.equal(drifted, 'drift');
  assert.match(lines[0], /→ drift\nwasm /);
  assert.ok(lines[0].includes(hash));
});

test('verify usage', () => {
  assert.equal(parseVerifyArgs(['registry']).account, 'registry');
  assert.equal(parseVerifyArgs(['alice.test.near', '--wasm', 'a.wasm']).wasm, 'a.wasm');
  assert.throws(() => parseVerifyArgs([]), /usage/);
  assert.throws(() => parseVerifyArgs(['registry', '--wasm']), /usage/);
});
