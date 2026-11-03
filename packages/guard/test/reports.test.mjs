// The registry blocklist (contract v0.3 `is_reported` / `get_report`) through the ChainReader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '@omniswarm/schemas';
import { createGuard, registryReader } from '../index.mjs';
import { createRecordedReader } from '../src/recorded-reader.mjs';
import { NOW, RECORDS, reader } from './chain.mjs';

const REPORT = {
  account_id: 'phish.testnet',
  reported_at_ms: NOW - 86_400_000,
  evidence_uri: 'https://evidence.example/phish-1',
  reason: 'drains approvals',
  reporter: 'operator.owner.testnet',
};

/** A view function over recorded registry state that logs every call. */
function fakeView({ reported = {}, attestations = {}, answer } = {}) {
  const calls = [];
  const view = async (method, args) => {
    calls.push([method, args]);
    if (answer) return answer(method, args);
    if (method === 'is_reported') return Object.hasOwn(reported, args.account_id);
    if (method === 'get_report') return reported[args.account_id] ?? null;
    if (method === 'get_attestation_for_account') return attestations[args.account] ?? null;
    throw new Error(`unexpected view ${method}`);
  };
  return { view, calls };
}

/** A reader shaped like the API's: chain views from the recorded snapshot, registry from `view`. */
function apiShapedReader(view) {
  const base = reader();
  return { getAccount: base.getAccount, getBlockTimestampMs: base.getBlockTimestampMs, getAccountAgeDays: base.getAccountAgeDays, ...registryReader(view) };
}

test('registryReader calls the v0.3 views with their exact argument names', async () => {
  const { view, calls } = fakeView({ reported: { 'phish.testnet': REPORT }, attestations: RECORDS.attestations });
  const registry = registryReader(view);
  assert.equal(await registry.isReported('phish.testnet'), true);
  assert.deepEqual(await registry.getReport('phish.testnet'), REPORT);
  assert.equal((await registry.getAttestationForAccount('clean.testnet')).request_hash, RECORDS.attestations['clean.testnet'].request_hash);
  assert.deepEqual(calls, [
    ['is_reported', { account_id: 'phish.testnet' }],
    ['get_report', { account_id: 'phish.testnet' }],
    ['get_attestation_for_account', { account: 'clean.testnet' }],
  ]);
});

test('a registry-reported account is blocked, with the evidence in the signals', async () => {
  const { view } = fakeView({ reported: { 'clean.testnet': { ...REPORT, account_id: 'clean.testnet' } }, attestations: RECORDS.attestations });
  const result = await createGuard({ reader: apiShapedReader(view), now: () => NOW }).check('clean.testnet');
  assert.deepEqual([result.verdict, result.reasons], ['block', ['REPORTED', 'ATTESTED_CLEAN']]);
  assert.equal(result.signals.reported, true);
  assert.deepEqual(result.signals.report, { evidenceUri: REPORT.evidence_uri, reason: REPORT.reason, reportedAtMs: REPORT.reported_at_ms, reporter: REPORT.reporter });
  assert.ok(validate('intake-api#guard-verdict-response', result).ok);
});

test('an unreported account never asks for a report and carries no report signal', async () => {
  const { view, calls } = fakeView({ attestations: RECORDS.attestations });
  const result = await createGuard({ reader: apiShapedReader(view), now: () => NOW }).check('clean.testnet');
  assert.deepEqual([result.verdict, result.reasons], ['allow', ['ATTESTED_CLEAN']]);
  assert.equal(result.signals.reported, false);
  assert.equal('report' in result.signals, false);
  assert.ok(!calls.some(([method]) => method === 'get_report'));
});

test('a malformed is_reported answer is unavailable, never a silent false', async () => {
  for (const bad of ['true', 1, null, {}]) {
    const { view } = fakeView({ attestations: RECORDS.attestations, answer: (method, args) => (method === 'is_reported' ? bad : RECORDS.attestations[args.account] ?? null) });
    const result = await createGuard({ reader: apiShapedReader(view), now: () => NOW }).check('clean.testnet');
    assert.equal(result.verdict, 'warn', JSON.stringify(bad));
    assert.equal(result.signals.reported, null);
    assert.deepEqual(result.signals.unavailable, ['reported']);
  }
});

test('a reader whose isReported resolves to a non-boolean is unavailable too', async () => {
  const base = reader();
  const result = await createGuard({ reader: { ...base, isReported: async () => /** @type {any} */ ('yes') }, now: () => NOW }).check('clean.testnet');
  assert.deepEqual([result.verdict, result.signals.unavailable], ['warn', ['reported']]);
});

test('malformed report and attestation answers reject', async () => {
  const registry = registryReader(async (method) => (method === 'get_report' ? { ...REPORT, evidence_uri: 'javascript:alert(1)' } : { request_hash: 1 }));
  await assert.rejects(registry.getReport('phish.testnet'), /get_report/);
  await assert.rejects(registry.getAttestationForAccount('phish.testnet'), /get_attestation_for_account/);
  assert.throws(() => registryReader(/** @type {any} */ (null)), TypeError);
});

test('a failing get_report keeps the block and lists the report as unavailable', async () => {
  const { view } = fakeView({ answer: (method) => {
    if (method === 'is_reported') return true;
    if (method === 'get_report') throw new Error('rpc down');
    return null;
  } });
  const result = await createGuard({ reader: apiShapedReader(view), now: () => NOW }).check('attacker.testnet');
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.reasons, ['REPORTED', 'SIGNAL_UNAVAILABLE', 'NOT_A_CONTRACT']);
  assert.deepEqual(result.signals.unavailable, ['report']);
});

test('a reader without getReport still blocks on isReported (the API reader today)', async () => {
  const { getReport, ...withoutReport } = reader();
  assert.equal(typeof getReport, 'function');
  const result = await createGuard({ reader: withoutReport, now: () => NOW }).check('attacker.testnet');
  assert.deepEqual([result.verdict, result.reasons], ['block', ['REPORTED', 'NOT_A_CONTRACT']]);
  assert.equal('report' in result.signals, false);
});

test('recorded reports count as reported and give their evidence', async () => {
  const recorded = createRecordedReader({ ...RECORDS, reports: { 'old-user.testnet': { ...REPORT, account_id: 'old-user.testnet' } } });
  const result = await createGuard({ reader: recorded, now: () => NOW }).check('old-user.testnet');
  assert.deepEqual([result.verdict, result.reasons], ['block', ['REPORTED', 'NOT_A_CONTRACT']]);
  assert.equal(result.signals.report.evidenceUri, REPORT.evidence_uri);
});
