import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '@omniswarm/schemas';
import { createGuard, httpSource } from '../index.mjs';
import { HASH_A, HASH_C, NOW, RECORDS, reader } from './chain.mjs';

const guard = (options = {}) => createGuard({ reader: reader(options.fail), now: () => NOW, ...options });

const EXPECTED = {
  'clean.testnet': ['allow', ['ATTESTED_CLEAN']],
  'legacy-clean.testnet': ['allow', ['ATTESTED_CLEAN']],
  'critical.testnet': ['block', ['ATTESTED_CRITICAL_STILL_DEPLOYED']],
  'changed.testnet': ['warn', ['CODE_CHANGED_SINCE_REVIEW']],
  'stale.testnet': ['warn', ['ATTESTATION_STALE', 'ATTESTED_CLEAN']],
  'unreviewed.testnet': ['warn', ['CONTRACT_NOT_REVIEWED']],
  'unconfirmed.testnet': ['warn', ['CONTRACT_NOT_REVIEWED']],
  'young-clean.testnet': ['warn', ['ACCOUNT_TOO_NEW', 'ATTESTED_CLEAN']],
  'reported-clean.testnet': ['block', ['REPORTED', 'ATTESTED_CLEAN']],
  'old-user.testnet': ['allow', ['NOT_A_CONTRACT']],
  'new-user.testnet': ['warn', ['ACCOUNT_TOO_NEW', 'NOT_A_CONTRACT']],
  'attacker.testnet': ['block', ['REPORTED', 'NOT_A_CONTRACT']],
  'missing.testnet': ['warn', ['ACCOUNT_TOO_NEW', 'NOT_A_CONTRACT']],
};

for (const [account, [verdict, reasons]] of Object.entries(EXPECTED)) {
  test(`check ${account} → ${verdict}, and the response matches guard-verdict-response`, async () => {
    const result = await guard().check(account);
    assert.equal(result.verdict, verdict);
    assert.deepEqual(result.reasons, reasons);
    const schema = validate('intake-api#guard-verdict-response', result);
    assert.ok(schema.ok, schema.errors.join('\n'));
  });
}

test('a clean verdict carries the attestation in schema shape and the drift signals', async () => {
  const result = await guard().check('clean.testnet');
  assert.deepEqual(Object.keys(result).sort(), ['attestation', 'reasons', 'signals', 'verdict']);
  assert.deepEqual(result.attestation, {
    requestHash: RECORDS.attestations['clean.testnet'].request_hash,
    reportSha256: 'd'.repeat(64),
    reportUri: 'https://reports.example/clean.testnet',
    deployed: 'clean.testnet',
    codeHash: HASH_A,
    maxSeverity: 'low',
  });
  assert.equal(result.signals.codeHashMatches, true);
  assert.equal(result.signals.attestationAgeDays, 10);
  assert.deepEqual(result.signals.review, { repo: 'near/example', commit: 'c'.repeat(40), blockHeight: 100 });
});

test('code drift reports both hashes', async () => {
  const { signals } = await guard().check('changed.testnet');
  assert.equal(signals.codeHash, HASH_C);
  assert.equal(signals.attestedCodeHash, HASH_A);
  assert.equal(signals.codeHashMatches, false);
});

test('an unconfirmed binding is ignored even if a reader returns it', async () => {
  const result = await guard().check('unconfirmed.testnet');
  assert.equal(result.attestation, undefined);
  assert.equal(result.signals.unconfirmedBinding, true);
  assert.equal(result.signals.hasAttestation, false);
});

test('reader outages become SIGNAL_UNAVAILABLE, never a throw and never allow', async () => {
  const methods = ['getAccount', 'getAttestationForAccount', 'isReported', 'getAccountAgeDays', 'getBlockTimestampMs'];
  for (const method of methods) {
    const result = await guard({ fail: new Set([method]) }).check('legacy-clean.testnet');
    assert.equal(result.verdict, 'warn', method);
    assert.ok(result.reasons.includes('SIGNAL_UNAVAILABLE'), method);
    assert.equal(result.signals.unavailable.length, 1, method);
  }
  const down = await guard({ fail: new Set(methods) }).check('clean.testnet');
  assert.deepEqual([down.verdict, down.reasons], ['warn', ['SIGNAL_UNAVAILABLE']]);
});

test('freshness uses the attested block_timestamp_ms without a block lookup', async () => {
  const result = await guard({ fail: new Set(['getBlockTimestampMs']) }).check('clean.testnet');
  assert.deepEqual([result.verdict, result.signals.attestationAgeDays, result.signals.unavailable], ['allow', 10, []]);
});

test('an outage cannot hide a block from the blocklist', async () => {
  const result = await guard({ fail: new Set(['getAccount', 'getAttestationForAccount']) }).check('attacker.testnet');
  assert.equal(result.verdict, 'block');
});

test('the local blocklist blocks an otherwise clean account', async () => {
  const result = await guard({ blocklist: ['clean.testnet'] }).check('clean.testnet');
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.reasons, ['REPORTED', 'ATTESTED_CLEAN']);
  assert.equal(result.signals.reported, true);
  assert.ok(validate('intake-api#guard-verdict-response', result).ok);
});

test('an invalid account id is a TypeError', async () => {
  for (const bad of ['', 'A.testnet', 'a', 'x'.repeat(65), 'bad..testnet', 42]) {
    await assert.rejects(guard().check(bad), TypeError);
  }
});

test('createGuard needs a reader or a source', () => {
  assert.throws(() => createGuard({}), TypeError);
});

test('httpSource sends account, network and key, and validates the answer', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url: String(url), key: init.headers['x-guard-key'] });
    return { ok: true, status: 200, json: async () => ({ verdict: 'allow', reasons: ['ATTESTED_CLEAN'], signals: {} }) };
  };
  const remote = createGuard({ source: httpSource({ apiUrl: 'https://api.example', network: 'testnet', apiKey: 'k1', fetch: fakeFetch }) });
  assert.equal((await remote.check('clean.testnet')).verdict, 'allow');
  assert.deepEqual(seen, [{ url: 'https://api.example/api/guard/verdict?account=clean.testnet&network=testnet', key: 'k1' }]);
});

test('httpSource failures and malformed answers reject', async () => {
  const status = createGuard({ source: httpSource({ apiUrl: 'https://api.example', network: 'testnet', fetch: async () => ({ ok: false, status: 429 }) }) });
  await assert.rejects(status.check('clean.testnet'), /429/);
  const shape = createGuard({ source: httpSource({ apiUrl: 'https://api.example', network: 'testnet', fetch: async () => ({ ok: true, json: async () => ({ verdict: 'ok' }) }) }) });
  await assert.rejects(shape.check('clean.testnet'), /malformed/);
});
