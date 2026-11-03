import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEMO_BY_DESIGN_GAPS, demoReportVerdict, demoVerdict, fixtureDigest } from './audit-demo-verdict.mjs';
import { buildExistingTestCatalog } from './review-workflow.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';
import { createSnapshot, disposeSnapshot } from './worker-isolation.mjs';

const expectedDigest = fixtureDigest(DEMO_FIXTURE);
const healthWith = (errors, reviewState = 'validated_outputs') => ({ state: 'incomplete', reviewState, errors, verification: { state: 'incomplete', gaps: errors } });
const demoReport = (health) => ({ meta: { demo: true }, health, sourceDigest: expectedDigest, expectedDigest });

test('the bundled fixture catalogs its client suite and NEAR build checks, leaving only the by-design sandbox gap', () => {
  const snapshot = createSnapshot(DEMO_FIXTURE);
  try {
    const catalog = buildExistingTestCatalog(snapshot.snapshot, snapshot.manifest);
    assert.deepEqual(catalog.tests.map((row) => `${row.kind}:${row.cwd}`).sort(), ['near-build:.', 'near-clippy:.', 'npm:client']);
    assert.deepEqual(catalog.coverageGaps, [...DEMO_BY_DESIGN_GAPS]);
    for (const lock of ['Cargo.lock', 'client/package-lock.json']) assert.ok(snapshot.manifest.files.some((file) => file.path === lock), lock);
  } finally { disposeSnapshot(snapshot); }
});

test('the demo exits 0 only for the bundled fixture with validated outputs and nothing but the by-design gap', () => {
  assert.deepEqual(demoVerdict(demoReport(healthWith([...DEMO_BY_DESIGN_GAPS]))), { code: 0, limited: [...DEMO_BY_DESIGN_GAPS] });
  const refusals = [
    [demoReport(healthWith([...DEMO_BY_DESIGN_GAPS, 'npm existing tests in client: no successful execution with nonzero test counts and no skipped tests.'])), /does not have by design: npm existing tests/],
    [demoReport(healthWith(['NEAR WASM build (cargo near build non-reproducible-wasm) in .: no successful offline build.'])), /does not have by design/],
    [demoReport(healthWith([...DEMO_BY_DESIGN_GAPS], 'incomplete')), /did not validate/],
    // The gap must come from the verification record, not be a review error with the same text.
    [demoReport({ ...healthWith([...DEMO_BY_DESIGN_GAPS]), verification: { gaps: [] } }), /does not have by design/],
    [{ ...demoReport(healthWith([...DEMO_BY_DESIGN_GAPS])), meta: { demo: false } }, /not stamped as the demo/],
    [{ ...demoReport(healthWith([...DEMO_BY_DESIGN_GAPS])), sourceDigest: 'f'.repeat(64) }, /not a review of the bundled fixture/],
    [{ ...demoReport(healthWith([...DEMO_BY_DESIGN_GAPS])), sourceDigest: undefined, expectedDigest: undefined }, /not a review of the bundled fixture/],
  ];
  for (const [input, reason] of refusals) {
    const verdict = demoVerdict(input);
    assert.equal(verdict.code, 2);
    assert.match(verdict.reason, reason);
  }
});

// A real NEAR target with the same single gap, even stamped demo (`--preset demo`), is not the bundled fixture.
test('a real NEAR target report with the same gap still exits 2', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-verdict-real-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'target');
  const out = path.join(root, 'out');
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(target, 'Cargo.toml'), '[package]\nname = "vault"\nversion = "0.1.0"\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\nnear-sdk = "5.30.0"\n');
  fs.writeFileSync(path.join(target, 'src/lib.rs'), 'pub fn inert() {}\n');
  const snapshot = createSnapshot(target);
  const catalog = buildExistingTestCatalog(snapshot.snapshot, snapshot.manifest);
  disposeSnapshot(snapshot);
  assert.deepEqual(catalog.coverageGaps, [...DEMO_BY_DESIGN_GAPS]);
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ demo: true }));
  fs.writeFileSync(path.join(out, 'report-health.json'), JSON.stringify(healthWith(catalog.coverageGaps)));
  fs.writeFileSync(path.join(out, 'source-manifest.json'), JSON.stringify(snapshot.manifest));
  assert.equal(demoReportVerdict(out, target).code, 0, 'the same report would pass against its own tree');
  const verdict = demoReportVerdict(out, DEMO_FIXTURE);
  assert.equal(verdict.code, 2);
  assert.match(verdict.reason, /not a review of the bundled fixture/);
});
