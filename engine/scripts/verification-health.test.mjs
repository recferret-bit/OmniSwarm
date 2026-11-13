import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verificationHealth } from './verification-health.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-verification-'));
  fs.mkdirSync(path.join(root, 'harness'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = {
    'source-manifest.json': { digest: 'source', files: [{ path: 'package.json' }] },
    'harness/existing-tests.json': { sourceDigest: 'source', tests: [{ id: 'suite', description: 'Existing fixture suite' }] },
  };
  const evidence = { stdout: '# pass 2\n# fail 0\n# skipped 0\n', stderr: '' };
  const output = 'harness/existing-test-output-verification-0.json';
  data[output] = evidence;
  data['harness/existing-test-results-verification.json'] = [{ testId: 'suite', sourceDigest: 'source', evidenceFile: output, evidenceHash: crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex'), exitCode: 0 }];
  fs.writeFileSync(path.join(root, 'harness/existing-test-results-verification.json'), 'fixture-index');
  const checks = [];
  for (const [tool, result] of [['gitleaks', '[]'], ['semgrep', '{"results":[],"errors":[]}'], ['osv-scanner', '{"results":[]}']]) {
    const evidenceFile = `harness/scanner-output-${tool}-0.json`;
    data[evidenceFile] = { code: 0, stdout: result };
    checks.push({ tool, state: 'passed', evidenceFile });
  }
  data['harness/scanner-output-node-deps-0.json'] = { code: 0, stdout: '{"nodeDeps":{"unresolved":0}}' };
  checks.push({ tool: 'cargo-audit', state: 'not_applicable' }, { tool: 'npm-audit', state: 'not_applicable' }, { tool: 'node-deps', state: 'passed', evidenceFile: 'harness/scanner-output-node-deps-0.json' });
  data['harness/scanner-results.json'] = { version: 1, checks };
  const read = name => { if (!(name in data)) throw Error('missing fixture'); return data[name]; };
  return { data, check: () => verificationHealth(root, read), output };
}

// The target's own suites are reported in `tests` and the audit's scanners in `tools`. Whether a report is complete
// is decided by the agents' review alone (report-contract.mjs), never by the project's tests or the scanners.
const rehash = (f, row) => { row.evidenceHash = crypto.createHash('sha256').update(JSON.stringify(f.data[f.output])).digest('hex'); };
const suiteOf = (f) => f.check().tests.suites[0];

test('a suite the sandbox never runs is a Tests note and leaves verification passed', t => {
  const f = fixture(t);
  const gap = 'NEAR contract tests in contracts are a local-sandbox coverage gap. cargo test can start near-sandbox or deploy to testnet and is not run offline.';
  f.data['harness/existing-tests.json'].coverageGaps = [gap, 'NEAR build verification unavailable: cargo-near and the WASM target are not provisioned; clippy and WASM compilation were not run.'];
  const health = f.check();
  assert.equal(health.state, 'passed');
  assert.deepEqual(health.gaps, []);
  assert.deepEqual(health.tests.notes, f.data['harness/existing-tests.json'].coverageGaps);
});

test('executed coverage requires scanner evidence and scope-correct applicability', t => {
  const f = fixture(t);
  assert.equal(f.check().state, 'passed');
  assert.deepEqual(f.check().tests.totals, { suites: 1, passed: 1, passedWithSkips: 0, failed: 0, notRun: 0, tests: { passed: 2, failed: 0, skipped: 0 } });
  assert.equal(f.check().tests.state, 'passed');
  f.data['source-manifest.json'].files.push({ path: 'package-lock.json' });
  assert.match(f.check().gaps.join('\n'), /invalid not-applicable/);
});

test('failed, empty, skipped, stale and altered suite runs are reported in Tests and never open a gap', t => {
  const f = fixture(t);
  const row = f.data['harness/existing-test-results-verification.json'][0];
  const expectSuite = (state, legacy) => {
    const health = f.check();
    assert.equal(health.state, 'passed', `a ${state} suite does not make verification incomplete`);
    assert.deepEqual(health.gaps, []);
    assert.equal(health.tests.suites[0].state, state);
    assert.equal(health.suites[0].state, legacy);
  };
  row.exitCode = 1;
  expectSuite('failed', 'failed_or_unverified');
  assert.equal(f.check().tests.state, 'failed');
  row.exitCode = 0;
  for (const [stdout, state] of [['# pass 0\n# fail 0\n', 'no_result'], ['# pass 2\n# fail 0\n# skipped 1\n', 'passed_with_skips'], ['# pass 2\n# fail 1\n', 'failed'], ['no execution summary', 'no_result']]) {
    f.data[f.output].stdout = stdout;
    rehash(f, row);
    expectSuite(state, 'failed_or_unverified');
  }
  assert.deepEqual(suiteOf(f).outputTail, ['no execution summary']);
  // The recorded output no longer matches its hash.
  f.data[f.output].stdout = '# pass 9\n# fail 0\n';
  expectSuite('unverified', 'failed_or_unverified');
  assert.match(suiteOf(f).result, /missing or was altered/);
  rehash(f, row);
  row.sourceDigest = 'different';
  expectSuite('not_run', 'not_run');
  assert.equal(f.check().tests.state, 'not_run');
});

test('a suite the coordinator could not start says why in its Tests row', t => {
  const f = fixture(t);
  f.data['harness/existing-test-results-verification.json'].length = 0;
  f.data['harness/existing-test-phase.json'] = [{ testId: 'suite', note: 'The suite could not be started: no space left on device' }, { testId: 'other', note: 'not in the catalog' }];
  assert.equal(f.check().state, 'passed');
  assert.equal(suiteOf(f).state, 'not_run');
  assert.deepEqual(suiteOf(f).notes, ['The suite could not be started: no space left on device']);
});

test('a missing catalog or an empty one is said in Tests, not as a gap', t => {
  const f = fixture(t);
  f.data['harness/existing-tests.json'].tests = [];
  assert.equal(f.check().state, 'passed');
  assert.equal(f.check().tests.state, 'none');
  assert.deepEqual(f.check().tests.notes, ['No executable test suite was catalogued for this target.']);
  f.data['harness/existing-tests.json'].sourceDigest = 'other-source';
  assert.equal(f.check().state, 'passed');
  assert.match(f.check().tests.notes.join('\n'), /catalog is missing or does not match the captured source/);
});

test('scanner error objects and missing output cannot support a recorded pass', t => {
  const f = fixture(t);
  f.data['harness/scanner-output-osv-scanner-0.json'] = { code: 127, stdout: '{"results":[]}' };
  assert.equal(f.check().state, 'gaps');
  assert.deepEqual(f.check().tools.notes, ['osv-scanner: scanner output does not support its recorded status.']);
  delete f.data['harness/scanner-results.json'];
  assert.match(f.check().gaps.join('\n'), /scanner evidence is missing/);
  assert.deepEqual(f.check().tools, { state: 'gaps', scanners: [], notes: ['Structured scanner evidence is missing or invalid.'], policy: f.check().tools.policy });
  assert.equal(f.check().tests.suites[0].state, 'passed', 'a scanner gap does not change what the suites recorded');
});

test('a passing attempt cannot conceal another failed attempt in the same run', t => {
  const f = fixture(t);
  const rows = f.data['harness/existing-test-results-verification.json'];
  rows.push({ ...rows[0], exitCode: 1 });
  assert.equal(f.check().state, 'passed');
  assert.equal(f.check().suites[0].state, 'failed_or_unverified');
  assert.equal(suiteOf(f).state, 'failed');
  assert.equal(suiteOf(f).attempts, 2);
});

test('missing program bytes are explained from the retained compiler output', t => {
  const f = fixture(t);
  const row = f.data['harness/existing-test-results-verification.json'][0];
  row.exitCode = 101;
  f.data[f.output].stderr = "error: couldn't read `/work/target/tmp/../deploy/ratpool_escrow.so`: No such file or directory (os error 2)";
  rehash(f, row);
  assert.match(suiteOf(f).notes.join('\n'), /Missing program artifact deploy\/ratpool_escrow.so.*--test-artifacts/);
  assert.equal(f.check().state, 'passed');
});

test('a Python tree requires the resolvability check and names the unpinned coverage gap', t => {
  const f = fixture(t);
  f.data['source-manifest.json'].files.push({ path: 'backend/requirements.txt' });
  assert.match(f.check().gaps.join('\n'), /python-deps: did not run; no result was recorded\./);
  const checks = f.data['harness/scanner-results.json'].checks;
  checks.push({ tool: 'python-deps', state: 'blocked', detail: '3 unpinned requirement(s)' });
  assert.match(f.check().gaps.join('\n'), /python-deps:.*3 unpinned requirement/);
  checks.pop();
  f.data['harness/scanner-output-python-deps-0.json'] = { code: 0, stdout: '{"pythonDeps":{"unresolved":0}}' };
  checks.push({ tool: 'python-deps', state: 'passed', evidenceFile: 'harness/scanner-output-python-deps-0.json' });
  assert.equal(f.check().state, 'passed');
});

test('a failed suite row carries its counts, every cause, the failing tests, its duration and capture truncation', t => {
  const f = fixture(t);
  const row = f.data['harness/existing-test-results-verification.json'][0];
  Object.assign(row, { exitCode: 1, durationMs: 1036860, dependencies: 'sealed', at: '2026-11-12T23:28:38.000Z', killedProcesses: [4711] });
  f.data[f.output] = { stdout: [
    'E   Failed: requires PG_BINDIR', 'E   Failed: requires PG_BINDIR',
    'FAILED tests/test_a.py::test_one - Failed: requires PG_BINDIR',
    'FAILED tests/test_a.py::test_two - Failed: requires PG_BINDIR',
    "ERROR tests/test_b.py - FileNotFoundError: [Errno 2] No such file or directory: '/work/runs/b816d2100178d035/src/docs/vectors.json'",
    'SKIPPED [2] tests/test_pg.py:25: Requires PostgreSQL', 'SKIPPED [1] tests/test_c.py:9: Requires PostgreSQL',
    '= 2 failed, 40 passed, 3 skipped, 308 errors in 9.00s =', '',
  ].join('\n'), stderr: '' };
  rehash(f, row);
  const suite = suiteOf(f);
  assert.equal(suite.state, 'failed');
  assert.equal(suite.result, 'Exit 1; 40 passed, 310 failed or errored, 3 skipped.');
  assert.deepEqual(suite.counts, { passed: 40, failed: 310, skipped: 3 });
  assert.deepEqual(suite.causes, [{ message: 'Failed: requires PG_BINDIR', count: 2 }, { message: "FileNotFoundError: [Errno 2] No such file or directory: 'docs/vectors.json'", count: 1 }]);
  assert.deepEqual([suite.causesTotal, suite.skipReasons, suite.skipReasonsTotal], [2, [{ message: 'Requires PostgreSQL', count: 3 }], 1]);
  assert.deepEqual(suite.failedTests, ['tests/test_a.py::test_one', 'tests/test_a.py::test_two', 'tests/test_b.py']);
  assert.equal(suite.failedTestsTotal, 3);
  assert.deepEqual([suite.durationMs, suite.dependencies, suite.exitCode, suite.evidenceFile], [1036860, 'sealed', 1, f.output]);
  assert.match(suite.notes.join('\n'), /1 process\(es\) the suite left running/);
  assert.deepEqual(f.check().tests.totals.tests, { passed: 40, failed: 310, skipped: 3 });
  assert.equal(f.check().state, 'passed');
  row.exitCode = 0;
  f.data[f.output] = { stdout: '# pass 2\n# fail 0\n# skipped 0\n', stderr: '', omittedBytes: 10 };
  rehash(f, row);
  assert.equal(suiteOf(f).state, 'passed');
  assert.equal(suiteOf(f).clean, false, 'a cut output is not a strict pass');
  assert.match(suiteOf(f).notes.join('\n'), /capture limit \(10 bytes omitted\)/);
});

// A NEAR build check is in the same catalog as the suites but has no test counts.
test('a NEAR build check passes only on exit 0 with its verified artifact, never on test counts', t => {
  const f = fixture(t);
  const catalog = f.data['harness/existing-tests.json'];
  const row = f.data['harness/existing-test-results-verification.json'][0];
  const set = (stdout, stderr = '', exitCode = 0) => {
    f.data[f.output] = { stdout, stderr };
    Object.assign(row, { exitCode });
    rehash(f, row);
  };
  const artifact = (bytes) => `near-build artifact: demo_vault.wasm sha256 ${'a'.repeat(64)} bytes ${bytes}\n`;
  catalog.tests[0] = { id: 'suite', kind: 'near-build', description: 'NEAR WASM build in .' };
  set(`Contract successfully built!\n${artifact(104857)}`);
  assert.equal(suiteOf(f).state, 'passed');
  assert.equal(suiteOf(f).result, 'Exit 0; verified WASM artifact.');
  for (const [stdout, exitCode] of [['# pass 2\n# fail 0\n', 0], ['Contract successfully built!\n', 0], [artifact(0), 0], [artifact(9), 101]]) {
    set(stdout, '', exitCode);
    assert.equal(suiteOf(f).state, 'failed', stdout);
    assert.match(suiteOf(f).result, /no verified WASM artifact/);
    assert.equal(f.check().state, 'passed', 'a failed build check is reported in Tests');
  }
  catalog.tests[0] = { id: 'suite', kind: 'near-clippy', description: 'NEAR clippy in .' };
  set('', '    Checking demo-vault v0.1.0\n    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.1s\n');
  assert.equal(suiteOf(f).state, 'passed');
  set('', 'error: could not compile `demo-vault`\n', 101);
  assert.equal(suiteOf(f).result, 'Exit 101; no completed clippy run in the output.');
});

test('the Tools block shows every required scanner with its result, and a failed scanner only as a gap', t => {
  const f = fixture(t);
  const tools = f.check().tools;
  assert.equal(tools.state, 'passed');
  assert.deepEqual(tools.scanners.map(row => [row.tool, row.state]), [['gitleaks', 'passed'], ['semgrep', 'passed'], ['osv-scanner', 'passed'], ['cargo-audit', 'not_applicable'], ['npm-audit', 'not_applicable'], ['node-deps', 'passed']]);
  assert.match(tools.policy, /does not decide whether this report is complete/);
  const checks = f.data['harness/scanner-results.json'].checks;
  const semgrep = checks.find(row => row.tool === 'semgrep');
  Object.assign(semgrep, { state: 'failed', detail: 'Timed out: killed at its 180s limit before it finished.', scope: '.' });
  checks.push({ tool: 'gitleaks', state: 'findings', findings: 44, scope: '.', evidenceFile: 'harness/scanner-output-gitleaks-1.json' });
  f.data['harness/scanner-output-gitleaks-1.json'] = { code: 1, stdout: JSON.stringify(Array.from({ length: 44 }, () => ({ RuleID: 'generic-api-key' }))) };
  checks.splice(checks.findIndex(row => row.tool === 'node-deps'), 1);
  const health = f.check();
  assert.equal(health.state, 'gaps');
  assert.deepEqual(health.gaps, ['semgrep: failed. Timed out: killed at its 180s limit before it finished.', 'node-deps: did not run; no result was recorded.']);
  assert.equal(health.tools.state, 'gaps');
  assert.deepEqual(health.tools.notes, [], 'a gap its scanner row already shows is not repeated as a note');
  const row = (tool) => health.tools.scanners.find(item => item.tool === tool);
  assert.deepEqual(row('semgrep'), { tool: 'semgrep', state: 'failed', findings: null, scopes: ['.'], detail: 'Timed out: killed at its 180s limit before it finished.' });
  assert.deepEqual(row('gitleaks'), { tool: 'gitleaks', state: 'findings', findings: 44, scopes: ['.'], detail: null });
  assert.deepEqual(row('node-deps'), { tool: 'node-deps', state: 'missing', findings: null, scopes: [], detail: null });
  assert.equal(health.tests.suites[0].state, 'passed', 'a scanner gap does not change what the suites recorded');
  delete semgrep.detail;
  assert.equal(f.check().tools.scanners.find(item => item.tool === 'semgrep').detail, 'No reason was recorded; its output is in harness/scanner-output-semgrep-0.json.');
});
