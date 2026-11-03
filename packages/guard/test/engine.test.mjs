import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, DEFAULT_POLICY } from '../src/engine.mjs';

const base = {
  account: 'x.testnet', exists: true, isContract: true, codeHash: 'H', reported: false, ageDays: 400,
  hasAttestation: true, unconfirmedBinding: false, attestedCodeHash: 'H', codeHashMatches: true,
  attestationAgeDays: 10, review: null, unavailable: [],
};

// [name, signal overrides, severity, expected verdict, expected reasons]
const TABLE = [
  ['attested clean, code unchanged', {}, 'low', 'allow', ['ATTESTED_CLEAN']],
  ['attested critical, code unchanged', {}, 'critical', 'block', ['ATTESTED_CRITICAL_STILL_DEPLOYED']],
  ['attested high, code unchanged', {}, 'high', 'block', ['ATTESTED_CRITICAL_STILL_DEPLOYED']],
  ['attested critical, code changed', { codeHashMatches: false }, 'critical', 'warn', ['CODE_CHANGED_SINCE_REVIEW']],
  ['attested clean, code changed', { codeHashMatches: false }, 'none', 'warn', ['CODE_CHANGED_SINCE_REVIEW']],
  ['reported, clean attestation', { reported: true }, 'none', 'block', ['REPORTED', 'ATTESTED_CLEAN']],
  ['contract without attestation', { hasAttestation: false, codeHashMatches: null }, null, 'warn', ['CONTRACT_NOT_REVIEWED']],
  ['stale clean attestation', { attestationAgeDays: 181 }, 'none', 'warn', ['ATTESTATION_STALE', 'ATTESTED_CLEAN']],
  ['young contract, clean attestation', { ageDays: 5 }, 'low', 'warn', ['ACCOUNT_TOO_NEW', 'ATTESTED_CLEAN']],
  ['old plain account', { isContract: false, hasAttestation: false, codeHashMatches: null }, null, 'allow', ['NOT_A_CONTRACT']],
  ['new plain account', { isContract: false, hasAttestation: false, codeHashMatches: null, ageDays: 0 }, null, 'warn', ['ACCOUNT_TOO_NEW', 'NOT_A_CONTRACT']],
  ['reported plain account', { isContract: false, hasAttestation: false, codeHashMatches: null, reported: true }, null, 'block', ['REPORTED', 'NOT_A_CONTRACT']],
  ['all signals unavailable', { exists: null, isContract: null, codeHash: null, reported: null, ageDays: null, hasAttestation: null, codeHashMatches: null, attestationAgeDays: null, unavailable: ['account', 'attestation', 'reported', 'accountAge'] }, null, 'warn', ['SIGNAL_UNAVAILABLE']],
  ['clean attestation but live code hash unavailable', { codeHash: null, codeHashMatches: null, unavailable: ['account'] }, 'none', 'warn', ['SIGNAL_UNAVAILABLE']],
  ['critical attestation, blocklist unavailable', { reported: null, unavailable: ['reported'] }, 'critical', 'block', ['ATTESTED_CRITICAL_STILL_DEPLOYED', 'SIGNAL_UNAVAILABLE']],
  ['nothing established', { isContract: null, hasAttestation: null, codeHashMatches: null, ageDays: null }, null, 'warn', ['SIGNAL_UNAVAILABLE']],
];

for (const [name, overrides, severity, verdict, reasons] of TABLE) {
  test(`engine: ${name}`, () => {
    assert.deepEqual(evaluate({ ...base, ...overrides }, severity, DEFAULT_POLICY), { verdict, reasons });
  });
}

test('engine: no combination with an unavailable signal is allow', () => {
  for (const [, overrides, severity] of TABLE) {
    const result = evaluate({ ...base, ...overrides, unavailable: ['accountAge'] }, severity);
    assert.notEqual(result.verdict, 'allow');
  }
});

test('engine: thresholds come from the policy', () => {
  const strict = { ...DEFAULT_POLICY, minAgeDays: 500, maxAttestAgeDays: 5 };
  assert.deepEqual(evaluate(base, 'low', strict).reasons, ['ATTESTATION_STALE', 'ACCOUNT_TOO_NEW', 'ATTESTED_CLEAN']);
  assert.equal(evaluate(base, 'medium', { ...DEFAULT_POLICY, severeLevels: ['critical', 'high', 'medium'] }).verdict, 'block');
});
