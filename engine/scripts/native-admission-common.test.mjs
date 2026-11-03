import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  matchesAdmission, privateDirectory, readPrivateReceipt, sha256File, suiteGateArgv, verifyAdmittedBinary, writePrivateJson,
} from '../native/admission-common.mjs';
import { nativeIdentity as codexIdentity } from '../native/codex-review/build.mjs';
import { nativeIdentity as grokIdentity } from '../native/grok-review/build.mjs';

function cache(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-admission-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.chmodSync(dir, 0o700);
  return dir;
}

test('an admitted binary needs a private receipt, a current identity and the recorded hash', async (t) => {
  const dir = cache(t);
  const binary = path.join(dir, 'review-bin');
  fs.writeFileSync(binary, '#!/bin/sh\n', { mode: 0o700 });
  const binarySha256 = await sha256File(binary);
  assert.equal(binarySha256, crypto.createHash('sha256').update('#!/bin/sh\n').digest('hex'));
  writePrivateJson(path.join(dir, 'runtime-admission.json'), { version: 1, admission: true, binarySha256 });
  assert.equal((fs.statSync(path.join(dir, 'runtime-admission.json')).mode & 0o777), 0o600);
  const ok = await verifyAdmittedBinary({ cache: dir, binary, matches: () => true });
  assert.equal(ok.binarySha256, binarySha256);
  await assert.rejects(verifyAdmittedBinary({ cache: dir, binary, matches: () => false }), /native_receipt_stale/);
  fs.appendFileSync(binary, 'changed\n');
  await assert.rejects(verifyAdmittedBinary({ cache: dir, binary, matches: () => true }), /native_binary_changed/);
  // A receipt reached through a link, or a cache readable by others, is refused.
  fs.renameSync(path.join(dir, 'runtime-admission.json'), path.join(dir, 'real.json'));
  fs.symlinkSync(path.join(dir, 'real.json'), path.join(dir, 'runtime-admission.json'));
  assert.throws(() => readPrivateReceipt(dir));
  fs.chmodSync(dir, 0o755);
  assert.throws(() => readPrivateReceipt(dir), /native_cache_rejected/);
  assert.throws(() => privateDirectory(dir, 'grok_cache_not_private'), /grok_cache_not_private/);
});

test('a receipt admits only the pinned source, the current digests and every gate in order', () => {
  const identity = { packageDigest: 'p', recipeDigest: 'r' };
  const receipt = { version: 1, admission: true, sourceCommit: 'pin', ...identity, binarySha256: 'a'.repeat(64), gates: [{ name: 'native', passed: true }, { name: 'node', passed: true }] };
  assert.equal(matchesAdmission(receipt, identity, ['native', 'node'], { sourceCommit: 'pin' }), true);
  assert.equal(matchesAdmission(receipt, identity, ['node', 'native'], { sourceCommit: 'pin' }), false);
  assert.equal(matchesAdmission(receipt, identity, ['native', 'node'], { sourceCommit: 'pin', sourceRevision: 'rev' }), false);
  assert.equal(matchesAdmission({ ...receipt, recipeDigest: 'old' }, identity, ['native', 'node'], { sourceCommit: 'pin' }), false);
});

test('both native recipes hash the shared admission module, and the suite gates run this scripts/ directory', () => {
  const scripts = path.dirname(new URL(import.meta.url).pathname);
  assert.ok(suiteGateArgv(scripts, 'node').includes(path.join(scripts, 'native-admission-common.test.mjs')));
  assert.ok(suiteGateArgv(scripts, 'docker').includes(path.join(scripts, 'grok-docker.docker.mjs')));
  // Changing the shared module must invalidate both receipts: it is a recipe input of each native profile.
  for (const profile of ['codex-review', 'grok-review']) {
    const build = fs.readFileSync(path.resolve(scripts, `../native/${profile}/build.mjs`), 'utf8');
    assert.match(build, /\['[^\]]*'\.\.\/admission-common\.mjs'\]\.map\(/, profile);
  }
  assert.match(codexIdentity().recipeDigest, /^[a-f0-9]{64}$/);
  assert.match(grokIdentity().recipeDigest, /^[a-f0-9]{64}$/);
});
