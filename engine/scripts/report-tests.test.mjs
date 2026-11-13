import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeStage1Artifacts } from './orchestrator-pipeline.mjs';
import { duration, testsHeadline, testsHtml, testsMarkdown, testsText, toolsHeadline, toolsHtml, toolsMarkdown, toolsText } from './report-tests.mjs';
import { toolsBlock } from './verification-health.mjs';

const suite = (fields) => ({
  id: 'suite', kind: 'pytest', cwd: 'backend', description: 'pytest existing tests in backend', attempts: 1, state: 'passed', clean: true,
  exitCode: 0, counts: { passed: 3, failed: 0, skipped: 0 }, at: '2026-11-12T23:28:38.000Z', durationMs: 4000, dependencies: 'sealed',
  evidenceFile: 'harness/existing-test-output-verification-0.json', result: 'Exit 0; 3 passed, 0 failed or errored, 0 skipped.',
  causes: [], causesTotal: 0, skipReasons: [], skipReasonsTotal: 0, failedTests: [], failedTestsTotal: 0, notes: [], outputTail: [], ...fields,
});
const block = (suites, notes = []) => {
  const count = (...states) => suites.filter((s) => states.includes(s.state)).length;
  const sum = (key) => suites.reduce((n, s) => n + (s.counts?.[key] || 0), 0);
  return {
    state: 'failed', suites, notes, policy: 'These are the target project\'s own tests. They do not decide whether this report is complete.',
    totals: { suites: suites.length, passed: count('passed'), passedWithSkips: count('passed_with_skips'), failed: count('failed', 'no_result', 'unverified'), notRun: count('not_run'), tests: { passed: sum('passed'), failed: sum('failed'), skipped: sum('skipped') } },
  };
};
const failing = suite({
  state: 'failed', clean: false, exitCode: 1, durationMs: 1036860, counts: { passed: 11768, failed: 466, skipped: 500 },
  result: 'Exit 1; 11768 passed, 466 failed or errored, 500 skipped.',
  causes: [{ message: 'AssertionError: bigint: Failed to load bindings', count: 328 }, { message: 'assert None', count: 10 }], causesTotal: 61,
  skipReasons: [{ message: 'Requires COMMAND_CENTER_POSTGRES_URL', count: 412 }], skipReasonsTotal: 1,
  failedTests: ['tests/test_cash.py::test_start', 'tests/test_cash.py::test_claim'], failedTestsTotal: 461,
  notes: ['2 process(es) the suite left running were ended after it.'],
});
const tests = block([suite({ kind: 'cargo', cwd: 'contracts', description: 'cargo existing tests in contracts', counts: { passed: 145, failed: 0, skipped: 0 }, result: 'Exit 0; 145 passed, 0 failed or errored, 0 skipped.' }), failing], ['EVM contract tests in evm (foundry) are not run: forge is not in the sandbox image.']);
const tools = toolsBlock({
  scanners: [
    { tool: 'gitleaks', state: 'findings', findings: 44, scopes: ['.'], detail: null },
    { tool: 'semgrep', state: 'failed', findings: null, scopes: ['.'], detail: 'Timed out: killed at its 180s limit before it finished.' },
    { tool: 'cargo-audit', state: 'not_applicable', findings: null, scopes: [], detail: null },
    { tool: 'node-deps', state: 'missing', findings: null, scopes: [], detail: null },
  ],
  notes: ['Sandbox record (harness/sandbox.md) is missing or invalid, so which checks the sandbox ran is unknown.'],
});

test('the Tests block names every suite with its result, counts, causes and the suites that are never run', () => {
  assert.equal(testsHeadline(tests), '2 suites: 1 passed, 1 failed. 11,913 tests passed, 466 failed or errored, 500 skipped.');
  const text = testsText(tests).join('\n');
  assert.match(text, /^Tests \(the target project's own suites; they do not decide whether this report is complete\):/);
  assert.match(text, /- cargo existing tests in contracts: passed\. Exit 0; 145 passed/);
  assert.match(text, /- pytest existing tests in backend: failed\. Exit 1; 11768 passed, 466 failed or errored, 500 skipped\./);
  assert.match(text, /328x AssertionError: bigint: Failed to load bindings/);
  assert.match(text, /skipped 412x: Requires COMMAND_CENTER_POSTGRES_URL/);
  assert.match(text, /- EVM contract tests in evm \(foundry\) are not run/);

  const md = testsMarkdown(tests).join('\n');
  assert.match(md, /^\n## Tests\n\n> These are the target project's own tests\./);
  assert.match(md, /\| pytest existing tests in backend \| failed \| 11,768 \| 466 \| 500 \| 1 \| 17m 17s \|/);
  assert.match(md, /- \*\*Full output\*\*: `harness\/existing-test-output-verification-0\.json`/);
  assert.match(md, /- \*\*Failure causes\*\* \(61 in all, the 2 most frequent listed\):\n {2}- 328x `AssertionError: bigint: Failed to load bindings`/);
  assert.match(md, /- \*\*Skip reasons\*\* \(most frequent first\):\n {2}- 412x `Requires COMMAND_CENTER_POSTGRES_URL`/);
  assert.match(md, /- \*\*Failing tests\*\* \(461, first 2 listed\):\n {2}- `tests\/test_cash\.py::test_start`/);
  assert.match(md, /### Suites that are not run\n\n- EVM contract tests/);
  assert.doesNotMatch(md, /### cargo existing tests in contracts/, 'a suite that passed needs no detail section');

  const html = testsHtml(tests);
  assert.match(html, /<td>pytest existing tests in backend<\/td><td class="test-failed"><strong>failed<\/strong><\/td><td>11,768<\/td><td>466<\/td><td>500<\/td><td>1<\/td><td>17m 17s<\/td>/);
  assert.match(html, /<details class="test-suite" open><summary>pytest existing tests in backend — failed<\/summary>/);
  assert.match(html, /<p>Failure causes \(61 in all, the 2 most frequent listed\):<\/p><ul><li>328× <code>AssertionError: bigint: Failed to load bindings<\/code><\/li>/);
  assert.match(html, /<p>Skip reasons \(most frequent first\):<\/p><ul><li>412× <code>Requires COMMAND_CENTER_POSTGRES_URL<\/code><\/li><\/ul>/);
  assert.match(html, /<summary>Failing tests \(461, first 2 listed\)<\/summary>/);
  assert.match(html, /Suites that are not run/);
});

test('test output is third-party text: control characters and markup never reach the terminal, Markdown or HTML', () => {
  const hostile = block([suite({
    state: 'no_result', clean: false, exitCode: 4, counts: null, description: 'pytest existing tests in <b>backend</b>',
    result: 'Exit 4; no test summary in the output.',
    causes: [{ message: '\u001b[31mred\u001b[0m `tick` <script>alert(1)</script>', count: 1 }],
    outputTail: ['ImportError while loading conftest', '``` injected fence', '<img src=x onerror=alert(1)>\u0007'],
    failedTests: ['tests/a.py::t\u001b[2J'], failedTestsTotal: 1,
  })]);
  const text = testsText(hostile).join('\n');
  assert.doesNotMatch(text, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/, 'no control character reaches the terminal');
  const md = testsMarkdown(hostile).join('\n');
  assert.doesNotMatch(md, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
  assert.match(md, /- 1x `\[31mred \[0m 'tick' <script>alert\(1\)<\/script>`/, 'a backtick cannot close the code span');
  assert.equal(md.match(/```/g).length, 2, 'the output tail cannot open or close a fence');
  const html = testsHtml(hostile);
  assert.doesNotMatch(html, /<script>|<img |<b>backend/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<pre>ImportError while loading conftest\n/);
});

test('a report without a test record, or with no catalogued suite, says so', () => {
  assert.deepEqual(testsText(null), []);
  assert.deepEqual(testsMarkdown(undefined), []);
  assert.match(testsHtml(null), /no test record/);
  const none = { ...block([], ['No executable test suite was catalogued for this target.']), state: 'none' };
  assert.equal(testsHeadline(none), 'No test suite of the target was catalogued.');
  assert.match(testsMarkdown(none).join('\n'), /### Suites that are not run\n\n- No executable test suite was catalogued/);
  assert.equal(testsHeadline(block([suite({ counts: { passed: 1, failed: 0, skipped: 0 } })])), '1 suite: 1 passed. 1 test passed, 0 failed or errored, 0 skipped.');
  assert.equal(duration(4000), '4s');
  assert.equal(duration(null), null);
});

test('the stage report carries the Tests block in its JSON, Markdown and HTML without changing its health', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-stage-tests-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const health = { state: 'validated_outputs', reviewState: 'validated_outputs', errors: [], incompletionNotes: [], tests, tools };
  writeStage1Artifacts({ out, meta: { name: 'target', pipelineMode: 'step-by-step' }, health, findings: [], incompletionNotes: [] });
  const doc = JSON.parse(fs.readFileSync(path.join(out, 'audit_stage_1.json'), 'utf8'));
  assert.equal(doc.health.state, 'validated_outputs');
  assert.deepEqual(doc.tests, tests);
  const md = fs.readFileSync(path.join(out, 'audit_stage_1.md'), 'utf8');
  assert.match(md, /- \*\*Health\*\*: `VALIDATED_OUTPUTS`/);
  assert.match(md, /\n## Tests\n\n> These are the target project's own tests\./);
  assert.match(md, /\| pytest existing tests in backend \| failed \| 11,768 \| 466 \| 500 \| 1 \| 17m 17s \|/);
  const html = fs.readFileSync(path.join(out, 'audit_stage_1.html'), 'utf8');
  assert.match(html, /<div class="card" id="tests"><h2>Tests<\/h2><p class="note">These are the target project&#39;s own tests\./);
  assert.match(html, /<summary>pytest existing tests in backend — failed<\/summary>/);
  assert.deepEqual(doc.tools, tools);
  assert.match(md, /\n## Tools\n\n> These are the audit's own scanners/);
  assert.match(html, /<div class="card" id="tools"><h2>Tools<\/h2>/);

  // A report from before the Tests block has none: the stage report says nothing rather than an empty section.
  writeStage1Artifacts({ out, meta: { name: 'target' }, health: { ...health, tests: undefined }, findings: [], incompletionNotes: [] });
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'audit_stage_1.md'), 'utf8'), /## Tests/);
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'audit_stage_1.html'), 'utf8'), /id="tests"/);
});

test('the Tools block names every scanner with its result and never says the report is incomplete', () => {
  assert.equal(tools.state, 'gaps');
  assert.equal(toolsHeadline(tools), '4 scanners: 1 with findings, 1 not applicable, 1 failed, 1 did not run. 1 note.');
  const text = toolsText(tools).join('\n');
  assert.match(text, /^Tools \(the audit's own scanners; they do not decide whether this report is complete\):/);
  assert.match(text, /- gitleaks: 44 findings\n/);
  assert.match(text, /- semgrep: failed\. Timed out: killed at its 180s limit before it finished\./);
  assert.match(text, /- node-deps: did not run\n/);
  assert.match(text, /- Sandbox record \(harness\/sandbox\.md\) is missing/);
  assert.doesNotMatch(text, /incomplete/i);
  const md = toolsMarkdown(tools).join('\n');
  assert.match(md, /\| semgrep \| failed \| — \| \. \| Timed out: killed at its 180s limit before it finished\. \|/);
  assert.match(md, /\| gitleaks \| findings \| 44 \| \. \| — \|/);
  const html = toolsHtml(tools);
  assert.match(html, /<td>node-deps<\/td><td class="tool-missing"><strong>did not run<\/strong><\/td>/);
  assert.equal(toolsHeadline(toolsBlock()), 'No scanner result was recorded.');
  assert.equal(toolsBlock().state, 'passed');
  assert.deepEqual(toolsText(null), []);
  assert.match(toolsHtml(undefined), /no tool record/);

  const hostile = toolsBlock({ scanners: [{ tool: 'semgrep', state: 'failed', findings: null, scopes: ['a|b'], detail: '\u001b[2J<script>x</script>' }], notes: ['<img src=x>\u0007'] });
  assert.doesNotMatch(toolsText(hostile).join('\n'), /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
  assert.match(toolsMarkdown(hostile).join('\n'), /\| a\/b \|/);
  assert.doesNotMatch(toolsHtml(hostile), /<script>|<img /);
});
