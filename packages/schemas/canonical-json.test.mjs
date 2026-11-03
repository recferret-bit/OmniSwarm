import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { canonicalJson, digestReport, reportDocument } from './canonical-json.mjs';

const { reports } = JSON.parse(fs.readFileSync(new URL('./canonical-json.vectors.json', import.meta.url), 'utf8'));
const ATTESTED_SAMPLE = 'f1d565b590ebe3953a45032be451719096222b9ee003ceee21900c1136bc35b1';

const reverseKeys = (value) => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  return value;
};

test('fixed vectors: canonical findings, canonical general review and report sha256', async () => {
  for (const v of reports) {
    assert.equal(canonicalJson(v.findings), v.canonicalFindings);
    assert.equal(canonicalJson(v.general ?? {}), v.canonicalGeneral);
    assert.equal(reportDocument(v.findings, v.general), v.canonicalFindings + v.canonicalGeneral);
    assert.equal(await digestReport(v.findings, v.general), v.sha256);
    assert.equal(crypto.createHash('sha256').update(reportDocument(v.findings, v.general)).digest('hex'), v.sha256);
  }
});

test('the landing sample still hashes to the attested value', async () => {
  assert.equal(reports[0].sha256, ATTESTED_SAMPLE);
  assert.equal(await digestReport(reports[0].findings, reports[0].general), ATTESTED_SAMPLE);
});

test('key order does not change the canonical form; array order does', async () => {
  for (const v of reports) {
    assert.equal(canonicalJson(reverseKeys(v.findings)), v.canonicalFindings);
    assert.equal(await digestReport(reverseKeys(v.findings), reverseKeys(v.general)), v.sha256);
  }
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('no whitespace, sorted keys at every depth, scalars as JSON.stringify writes them', () => {
  assert.equal(canonicalJson({ b: [{ d: 1, c: 'x y' }], a: null, e: true, f: 1.5 }), '{"a":null,"b":[{"c":"x y","d":1}],"e":true,"f":1.5}');
  assert.equal(canonicalJson('q"'), '"q\\""');
});

test('an absent or null general review counts as {}', () => {
  assert.equal(reportDocument({ findings: [] }, undefined), '{"findings":[]}{}');
  assert.equal(reportDocument({ findings: [] }, null), '{"findings":[]}{}');
});
