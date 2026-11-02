import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { canonicalRequestMessage, requestHash } from './canonical-message.mjs';

const { vectors } = JSON.parse(fs.readFileSync(new URL('./canonical-message.vectors.json', import.meta.url), 'utf8'));

test('fixed vectors: canonical message and sha256 match', async () => {
  for (const v of vectors) {
    const message = canonicalRequestMessage(v.input);
    assert.equal(message, v.message);
    assert.equal(await requestHash(message), v.hash);
    assert.equal(v.hash, crypto.createHash('sha256').update(v.message, 'utf8').digest('hex'));
  }
});

test('key order of the input does not change the message or the hash', async () => {
  for (const v of vectors) {
    const reversed = Object.fromEntries(Object.entries(v.input).reverse());
    const message = canonicalRequestMessage(reversed);
    assert.equal(message, v.message);
    assert.equal(await requestHash(message), v.hash);
  }
});

test('message has sorted keys, no whitespace, v:1, and null for absent deployed', () => {
  const { deployed, ...rest } = vectors[0].input;
  const message = canonicalRequestMessage(rest);
  assert.match(message, /^\{"account":.*,"commit":.*,"deployed":null,"network":.*,"nonce":.*,"preset":.*,"repo":.*,"v":1\}$/);
  assert.ok(!/\s(?=[^"]*(?:"[^"]*"[^"]*)*$)/.test(message), 'no whitespace outside strings');
});

test('missing, empty or unknown fields are rejected', () => {
  const base = vectors[0].input;
  assert.throws(() => canonicalRequestMessage({ ...base, account: '' }), TypeError);
  assert.throws(() => canonicalRequestMessage({ ...base, nonce: undefined }), TypeError);
  assert.throws(() => canonicalRequestMessage({ ...base, extra: 'x' }), TypeError);
  assert.throws(() => canonicalRequestMessage(null), TypeError);
});
