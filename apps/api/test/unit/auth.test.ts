// NEP-413 (W08-10/11) with reproducible vectors from fixed test seeds (test-only keys, not secrets),
// and repo URL normalisation (W08-13).
// Regenerate the vectors with UPDATE_VECTORS=1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DevWallet } from '../../scripts/dev-wallet.ts';
import { decodePublicKey, decodeSignature, verifyNep413 } from '../../src/modules/auth/nep413.ts';
import { loginMessage } from '../../src/modules/auth/near-login.ts';
import { normalizeRepoUrl } from '../../src/github/repo-url.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';

const FILE = path.join(APP_ROOT, 'test/fixtures/nep413.json');
const RECIPIENT = 'omniswarm.near';
const NONCE = Buffer.alloc(32, 1).toString('base64');
const OTHER_NONCE = Buffer.alloc(32, 2).toString('base64');

interface Vector { name: string; publicKey: string; signature: string; message: string; nonce: string; recipient: string; valid: boolean }

function vectors(): Vector[] {
  const alice = new DevWallet('alice.testnet', 'omniswarm-test-seed-alice');
  const mallory = new DevWallet('alice.testnet', 'omniswarm-test-seed-mallory');
  const good = alice.login(NONCE, RECIPIENT);
  const message = loginMessage('alice.testnet', NONCE);
  const vector = (name: string, body: typeof good, extra: Partial<Vector> = {}): Vector =>
    ({ name, publicKey: body.publicKey, signature: body.signature, message, nonce: body.nonce, recipient: RECIPIENT, valid: false, ...extra });
  return [
    vector('valid', good, { valid: true }),
    { ...vector('tampered-message', good), message: message.replace('alice', 'alicf') },
    vector('wrong-recipient', alice.login(NONCE, 'evil.near')),
    vector('wrong-nonce', { ...good, nonce: OTHER_NONCE }),
    vector('wrong-key', { ...good, publicKey: mallory.publicKey }),
  ];
}

test('NEP-413 vectors reproduce from fixed seeds and verify as recorded', () => {
  const fresh = vectors();
  if (process.env.UPDATE_VECTORS === '1') fs.writeFileSync(FILE, `${JSON.stringify(fresh, null, 2)}\n`);
  const recorded = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Vector[];
  assert.deepEqual(recorded, fresh, 'regenerating gives the committed vectors');
  for (const v of recorded) {
    const key = decodePublicKey(v.publicKey);
    const signature = decodeSignature(v.signature);
    assert.ok(key && signature);
    assert.equal(verifyNep413(key, signature, v.message, Buffer.from(v.nonce, 'base64'), v.recipient), v.valid, v.name);
  }
});

test('signatures decode from base64 (wallets) or base58 (compat), nothing else', () => {
  const sig = Buffer.alloc(64, 9);
  assert.deepEqual(decodeSignature(sig.toString('base64')), sig);
  assert.equal(decodeSignature('not a signature'), null);
  assert.equal(decodeSignature(Buffer.alloc(32).toString('base64')), null);
  assert.equal(decodePublicKey('ed25519:short'), null);
});

test('the login message is exactly {account, kind, nonce, v} in this order, no spaces', () => {
  assert.equal(loginMessage('alice.near', NONCE), `{"account":"alice.near","kind":"login","nonce":"${NONCE}","v":1}`);
});

test('repo URLs normalise to owner/name and an optional ref', () => {
  assert.deepEqual(normalizeRepoUrl('https://github.com/near/near-sdk-rs'), { repo: 'near/near-sdk-rs', ref: null });
  assert.deepEqual(normalizeRepoUrl('https://github.com/near/near-sdk-rs.git'), { repo: 'near/near-sdk-rs', ref: null });
  assert.deepEqual(normalizeRepoUrl('https://github.com/near/near-sdk-rs/tree/release/5.x/'), { repo: 'near/near-sdk-rs', ref: 'release/5.x' });
  assert.deepEqual(normalizeRepoUrl('https://github.com/near/near-sdk-rs@v5.30.0'), { repo: 'near/near-sdk-rs', ref: 'v5.30.0' });
  assert.deepEqual(normalizeRepoUrl('https://github.com/a--b/.github'), { repo: 'a--b/.github', ref: null });
  for (const bad of ['git@github.com:near/x', 'http://github.com/near/x', 'https://gitlab.com/near/x', 'https://github.com/near/x?y=1',
    'https://github.com/near/x/tree/../../etc', 'https://github.com/-x/y', 'https://github.com/near', 'https://github.com/near/x/blob/main']) {
    assert.throws(() => normalizeRepoUrl(bad), /Repo URL/, bad);
  }
});
