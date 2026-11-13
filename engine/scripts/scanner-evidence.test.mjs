import assert from 'node:assert/strict';
import test from 'node:test';
import { failedTests, failureCauses, killedDetail, scannerEvidence, skipReasons, testCounts } from './scanner-evidence.mjs';

test('scanner failures, error envelopes and malformed output cannot become clean scans', () => {
  for (const code of [127, 124, 2]) assert.equal(scannerEvidence('osv-scanner', { code, stdout: '{"results":[]}' }).state, 'failed');
  for (const tool of ['semgrep', 'osv-scanner', 'cargo-audit', 'npm-audit', 'gitleaks']) {
    for (const stdout of ['', '{"error":"unavailable"}', '{}', 'null']) assert.equal(scannerEvidence(tool, { code: 0, stdout }).state, 'failed');
  }
  assert.equal(scannerEvidence('semgrep', { code: 0, stdout: '{"results":[],"errors":[{"type":"ParseError"}]}' }).state, 'failed');
  assert.equal(scannerEvidence('semgrep', { code: 0, stdout: '{"results":[{}],"errors":[{"level":"warn","type":"Syntax error"},{"level":"error","type":"Rule parse error"}]}' }).state, 'failed');
  assert.deepEqual(scannerEvidence('semgrep', { code: 0, stdout: '{"results":[{},{}],"errors":[{"level":"warn","type":"PartialParsing"}]}' }), { tool: 'semgrep', exitCode: 0, state: 'findings', findings: 2, parseWarnings: 1 });
  assert.equal(scannerEvidence('osv-scanner', { code: 1, stdout: '{"results":[]}' }).state, 'failed');
  assert.equal(scannerEvidence('osv-scanner', { code: 0, stdout: '{"results":[]}' }).state, 'passed');
  assert.equal(scannerEvidence('gitleaks', { code: 0, stdout: '[{"RuleID":"fixture"}]' }).state, 'findings');
  assert.equal(scannerEvidence('python-deps', { code: 0, stdout: '{"pythonDeps":{"unresolved":0}}' }).state, 'passed');
  assert.equal(scannerEvidence('python-deps', { code: 0, stdout: '{"pythonDeps":{"unresolved":3}}' }).state, 'failed');
});

test('a scanner killed at its time limit is a failed scan that says so', () => {
  const timedOut = { code: 1, stdout: '', stderr: '', signal: 'SIGKILL', elapsedMs: 180_004, timeoutMs: 180_000 };
  assert.deepEqual(scannerEvidence('semgrep', timedOut), { tool: 'semgrep', exitCode: 1, state: 'failed', findings: null, detail: 'Timed out: killed at its 180s limit before it finished.' });
  assert.match(killedDetail({ code: 1, signal: 'SIGKILL', elapsedMs: 41_000, timeoutMs: 900_000 }), /Killed by SIGKILL after 41s, inside its 900s limit; this is not a timeout/);
  assert.equal(killedDetail({ code: 1, signal: 'SIGTERM' }), 'Killed by SIGTERM before it finished.');
  assert.equal(killedDetail({ code: 1, stdout: '' }), null);
  // An exit the scanner chose itself carries no kill detail, failed or not.
  assert.deepEqual(scannerEvidence('semgrep', { code: 2, stdout: '' }), { tool: 'semgrep', exitCode: 2, state: 'failed', findings: null });
  assert.equal('detail' in scannerEvidence('gitleaks', { code: 0, stdout: '[]' }), false);
});

test('execution summaries distinguish nonzero tests, failures, skips and absent evidence', () => {
  assert.deepEqual(testCounts('test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\ntest result: ok. 0 passed; 0 failed; 0 ignored'), { passed: 21, failed: 0, skipped: 0 });
  assert.deepEqual(testCounts('# pass 3\n# fail 1\n# skipped 2\n# todo 1\n'), { passed: 3, failed: 1, skipped: 3 });
  assert.deepEqual(testCounts('ℹ tests 13\nℹ suites 0\nℹ pass 12\nℹ fail 0\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0\n'), { passed: 12, failed: 0, skipped: 1 });
  assert.deepEqual(testCounts('\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m23 failed\x1b[39m | 469 passed (492)\n      Tests  2 failed | 2371 passed (2373)\n'), { passed: 2371, failed: 25, skipped: 0 });
  assert.deepEqual(testCounts(' Test Files  4 passed (4)\n      Tests  30 passed | 2 skipped (32)\n'), { passed: 30, failed: 0, skipped: 2 });
  assert.deepEqual(testCounts('...\n== 3 failed, 120 passed, 2 skipped, 1 error in 4.21s =='), { passed: 120, failed: 4, skipped: 2 });
  assert.deepEqual(testCounts('........\n8 passed in 0.31s'), { passed: 8, failed: 0, skipped: 0 });
  assert.deepEqual(testCounts('231 failed, 8930 passed, 667 skipped, 7752 warnings, 415 errors, 26 subtests passed in 752.20s (0:12:32)'), { passed: 8930, failed: 646, skipped: 667 });
  assert.equal(testCounts('command completed successfully'), null);
  assert.deepEqual(testCounts('test result: ok. 0 passed; 0 failed; 0 ignored'), { passed: 0, failed: 0, skipped: 0 });
});

test('failure causes are grouped by message, most frequent first, and the failing tests are named', () => {
  const stdout = '_ ERROR at setup of test_a _\nE   Failed: Real PostgreSQL verification requires PG_BINDIR server binaries\n_ ERROR at setup of test_b _\nE   Failed: Real PostgreSQL verification requires PG_BINDIR server binaries\nE   AssertionError: one-off\n';
  assert.deepEqual(failureCauses(stdout), [{ message: 'Failed: Real PostgreSQL verification requires PG_BINDIR server binaries', count: 2 }, { message: 'AssertionError: one-off', count: 1 }]);
  assert.deepEqual(failureCauses('8 passed in 0.31s'), []);
  // The short summary wins over traceback lines, and a per-run copy path does not split one cause in two.
  const summary = "E   noise\nE   noise\nE   noise\nERROR tests/a.py::t1 - FileNotFoundError: '/work/runs/b816d2100178d035/src/docs/v.json'\nERROR tests/a.py::t2 - FileNotFoundError: '/work/runs/0011223344556677/src/docs/v.json'\nFAILED tests/b.py::t3 - assert False\n";
  assert.deepEqual(failureCauses(summary), [{ message: "FileNotFoundError: 'docs/v.json'", count: 2 }, { message: 'assert False', count: 1 }]);
  assert.deepEqual(failureCauses(summary, 1), [{ message: "FileNotFoundError: 'docs/v.json'", count: 2 }]);
  assert.deepEqual(failedTests(summary), { names: ['tests/a.py::t1', 'tests/a.py::t2', 'tests/b.py::t3'], total: 3 });
  assert.deepEqual(failedTests('test escrow::refund ... FAILED\ntest escrow::open ... ok\ntest escrow::refund ... FAILED\n'), { names: ['escrow::refund'], total: 1 });
  assert.deepEqual(failedTests(summary, 2), { names: ['tests/a.py::t1', 'tests/a.py::t2'], total: 3 });
  // pytest -rs: one line per place and reason, with the number of tests skipped there.
  const skipped = 'SKIPPED [3] tests/test_pg.py:25: Requires COMMAND_CENTER_POSTGRES_URL\nSKIPPED [1] tests/test_cash.py:149: PostgreSQL migration acceptance\nSKIPPED [2] tests/test_identity.py:23: Requires COMMAND_CENTER_POSTGRES_URL\n';
  assert.deepEqual(skipReasons(skipped), [{ message: 'Requires COMMAND_CENTER_POSTGRES_URL', count: 5 }, { message: 'PostgreSQL migration acceptance', count: 1 }]);
  assert.deepEqual(skipReasons(skipped, 1), [{ message: 'Requires COMMAND_CENTER_POSTGRES_URL', count: 5 }]);
  assert.deepEqual(skipReasons(summary), []);
});
