import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { NEP413_TAG, b58decode, b58encode, nep413Payload } from './nep413.mjs';

const { payloads, base58 } = JSON.parse(fs.readFileSync(new URL('./nep413.vectors.json', import.meta.url), 'utf8'));
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const unhex = (text) => new Uint8Array(Buffer.from(text, 'hex'));

test('fixed vectors: NEP-413 payload bytes and their sha256', () => {
  for (const v of payloads) {
    const payload = nep413Payload(v.message, unhex(v.nonceHex), v.recipient);
    assert.ok(payload instanceof Uint8Array);
    assert.equal(hex(payload), v.payloadHex);
    assert.equal(crypto.createHash('sha256').update(payload).digest('hex'), v.sha256);
  }
});

test('payload layout: u32 LE tag, borsh message, nonce, borsh recipient, absent callback', () => {
  const nonce = new Uint8Array(32).fill(9);
  const payload = nep413Payload('ab', nonce, 'r');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  assert.equal(view.getUint32(0, true), NEP413_TAG);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(new TextDecoder().decode(payload.subarray(8, 10)), 'ab');
  assert.deepEqual(payload.subarray(10, 42), nonce);
  assert.equal(view.getUint32(42, true), 1);
  assert.equal(payload[46], 'r'.charCodeAt(0));
  assert.equal(payload[47], 0);
  assert.equal(payload.length, 48);
});

test('a Node Buffer nonce gives the same bytes as a Uint8Array nonce', () => {
  const v = payloads[0];
  assert.equal(hex(nep413Payload(v.message, Buffer.from(v.nonceHex, 'hex'), v.recipient)), v.payloadHex);
});

test('the nonce must be exactly 32 bytes', () => {
  for (const size of [0, 31, 33]) assert.throws(() => nep413Payload('m', new Uint8Array(size), 'r'), /nonce must be 32 bytes/);
});

test('fixed vectors: base58 encode and decode', () => {
  for (const v of base58) {
    assert.equal(b58encode(unhex(v.hex)), v.text);
    assert.equal(b58encode(Buffer.from(v.hex, 'hex')), v.text);
    const decoded = b58decode(v.text);
    assert.ok(decoded instanceof Uint8Array);
    assert.equal(hex(decoded), v.decodedHex);
  }
});

test('base58 round-trips random keys, signatures and leading zeros', () => {
  for (const bytes of [crypto.randomBytes(32), crypto.randomBytes(64), Buffer.concat([Buffer.from([0, 0]), crypto.randomBytes(30)])]) {
    assert.equal(hex(b58decode(b58encode(bytes))), hex(bytes));
  }
});

test('base58 rejects characters outside the alphabet', () => {
  for (const text of ['0', 'O', 'I', 'l', 'abc+', ' 1']) assert.throws(() => b58decode(text), /invalid base58/);
});
