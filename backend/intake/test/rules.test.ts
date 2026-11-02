import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { b58decode, b58encode, buildSignedRequest, generateKeyPair, quoteRepo, verifyNep413 } from '../src/lib.ts';

test('base58 round-trips keys and a leading zero', () => {
  for (const bytes of [crypto.randomBytes(32), Buffer.concat([Buffer.from([0]), crypto.randomBytes(31)])]) {
    assert.deepEqual(b58decode(b58encode(bytes)), bytes);
  }
});

test('a NEP-413 signature fails when the message changes', async () => {
  const keys = generateKeyPair();
  const body = await buildSignedRequest({
    privateKey: keys.privateKey,
    rawPublic: keys.rawPublic,
    accountId: 'alice.mock',
    repo: 'near/near-sdk-rs',
    commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    nonce: crypto.randomBytes(32).toString('base64'),
    recipient: 'omniswarm.testnet',
  });
  const nonce = Buffer.from(body.nonce, 'base64');
  assert.equal(verifyNep413(keys.rawPublic, b58decode(body.signature), body.message, nonce, 'omniswarm.testnet'), true);
  const tampered = body.message.replace('alice.mock', 'alice.mokk');
  assert.equal(verifyNep413(keys.rawPublic, b58decode(body.signature), tampered, nonce, 'omniswarm.testnet'), false);
});

test('recorded repos reject private, archived and oversized trees', () => {
  assert.equal(quoteRepo('https://github.com/near/near-sdk-rs', 204800).normalizedRepo, 'near/near-sdk-rs');
  assert.throws(() => quoteRepo('https://github.com/private/hidden', 204800), /Private/);
  assert.throws(() => quoteRepo('https://github.com/archived/old', 204800), /Archived/);
  assert.throws(() => quoteRepo('https://github.com/huge/repo', 204800), /size cap/);
});
