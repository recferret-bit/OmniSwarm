// NEP-413 (W08-10/11) with reproducible vectors from fixed test seeds (test-only keys, not secrets),
// the canonical signed message (W08-09) and repo URL normalisation (W08-13).
// Regenerate the vectors with UPDATE_VECTORS=1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DevWallet } from '../../scripts/dev-wallet.ts';
import { decodePublicKey, decodeSignature, verifyNep413 } from '../../src/modules/auth/nep413.ts';
import { parseSignedMessage } from '../../src/modules/auth/signed-message.ts';
import { normalizeRepoUrl } from '../../src/modules/quote/repo-url.ts';
import { AppError } from '../../src/shared/errors.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';

const FILE = path.join(APP_ROOT, 'test/fixtures/nep413.json');
const RECIPIENT = 'omniswarm.testnet';
const NONCE = Buffer.alloc(32, 1).toString('base64');
const OTHER_NONCE = Buffer.alloc(32, 2).toString('base64');

interface Vector { name: string; publicKey: string; signature: string; message: string; nonce: string; recipient: string; valid: boolean }

function vectors(): Vector[] {
  const alice = new DevWallet('alice.testnet', 'omniswarm-test-seed-alice');
  const mallory = new DevWallet('alice.testnet', 'omniswarm-test-seed-mallory');
  const fields = { commit: 'a'.repeat(40), deployed: null, network: 'testnet', nonce: NONCE, preset: 'scripted', repo: 'near/near-sdk-rs' };
  const good = alice.signRequest(fields, RECIPIENT);
  const vector = (name: string, body: typeof good, extra: Partial<Vector> = {}): Vector =>
    ({ name, publicKey: body.publicKey, signature: body.signature, message: body.message, nonce: body.nonce, recipient: RECIPIENT, valid: false, ...extra });
  return [
    vector('valid', good, { valid: true }),
    vector('tampered-message', { ...good, message: good.message.replace('near-sdk-rs', 'near-sdk-rx') }),
    vector('wrong-recipient', alice.signRequest(fields, 'evil.testnet')),
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

test('the signed message must be canonical with exactly the eight keys', () => {
  const dev = new DevWallet('alice.testnet', 'seed');
  const { message } = dev.signRequest({ commit: 'a'.repeat(40), deployed: null, network: 'testnet', nonce: NONCE, preset: 'scripted', repo: 'o/r' }, RECIPIENT);
  assert.equal(parseSignedMessage(message).repo, 'o/r');
  const object = JSON.parse(message);
  for (const bad of [JSON.stringify({ ...object, x: 1 }), JSON.stringify(object, null, 2), JSON.stringify({ ...object, v: 2 }),
    JSON.stringify({ ...object, preset: 'cli:claude:opus' }), JSON.stringify({ ...object, network: 'localnet' }), '[]']) {
    assert.throws(() => parseSignedMessage(bad), (error: unknown) => error instanceof AppError && error.code === 'MESSAGE_INVALID', bad);
  }
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
