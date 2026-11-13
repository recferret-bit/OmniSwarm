import crypto from 'node:crypto';
import fs from 'node:fs';
import { scannerEvidence, testCounts, missingTestArtifact, testSetupCause, failureCauses, failedTests, skipReasons } from './scanner-evidence.mjs';
import { NEAR_BUILD_ARTIFACT, NEAR_BUILD_KINDS } from './review-workflow.mjs';

// Suites the coordinator could not start, written by the tests phase: [{ testId, note }].
export const TEST_PHASE_FILE = 'harness/existing-test-phase.json';

// A suite passes with nonzero test counts and nothing failed or skipped. A NEAR build check has no test counts:
// near-build passes with the runner's verified WASM artifact line, near-clippy with cargo's Finished line.
function executionPassed(entry, row, evidence) {
  if (row.exitCode !== 0 || evidence.omittedBytes) return false;
  if (entry.kind === 'near-build') return NEAR_BUILD_ARTIFACT.test(evidence.stdout);
  if (entry.kind === 'near-clippy') return /^\s*Finished\b/m.test(evidence.stderr);
  const counts = testCounts(evidence.stdout);
  return counts?.passed > 0 && counts.failed === 0 && counts.skipped === 0;
}

function failureSummary(entry, row, counts) {
  if (NEAR_BUILD_KINDS.includes(entry.kind)) return `Exit ${row.exitCode}; ${entry.kind === 'near-build' ? 'no verified WASM artifact' : 'no completed clippy run'} in the output.`;
  return `Exit ${row.exitCode}; ${counts ? `${counts.passed} passed, ${counts.failed} failed or errored, ${counts.skipped} skipped` : 'no test summary in the output'}.`;
}

// Causes and skip reasons kept per suite. Failing test names are capped in scanner-evidence.mjs (failedTests).
const LISTED = 50;
const outputTail = (text) => String(text).replace(/\/work\/runs\/[0-9a-f]+\/src\//g, '').split('\n').map(line => line.trimEnd()).filter(Boolean).slice(-12).map(line => line.slice(0, 300));

// What the run recorded about one attempt of a catalogued suite. `state` is its outcome: passed, passed_with_skips,
// failed (a test failed, or the run ended non-zero), no_result (no test summary, or no test ran) or unverified
// (the recorded output is missing or was altered). `clean` is the strict reading: nothing failed, skipped or cut.
function attemptOf(entry, row, read) {
  const base = { exitCode: Number.isSafeInteger(row.exitCode) ? row.exitCode : null, at: typeof row.at === 'string' ? row.at : null, durationMs: Number.isFinite(row.durationMs) ? row.durationMs : null, dependencies: typeof row.dependencies === 'string' ? row.dependencies : null };
  try {
    if (!/^harness\/existing-test-output-[\w-]+-\d+\.json$/.test(row.evidenceFile)) throw Error();
    const evidence = read(row.evidenceFile);
    if (crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex') !== row.evidenceHash) throw Error();
    const build = NEAR_BUILD_KINDS.includes(entry.kind);
    const counts = build ? null : testCounts(evidence.stdout);
    const clean = executionPassed(entry, row, evidence);
    const notes = [];
    if (row.exitCode !== 0) { const cause = missingTestArtifact(evidence.stderr) || testSetupCause(evidence.stdout, evidence.stderr); if (cause) notes.push(cause); }
    // Aggregated per-crate summaries can sit in the omitted middle of an oversized output.
    if (evidence.omittedBytes) notes.push(`Output exceeded the capture limit (${evidence.omittedBytes} bytes omitted); counts and causes come from what was kept.`);
    if (Array.isArray(row.killedProcesses) && row.killedProcesses.length) notes.push(`${row.killedProcesses.length} process(es) the suite left running were ended after it.`);
    const output = `${evidence.stdout}\n${evidence.stderr}`;
    const failed = clean ? { names: [], total: 0 } : failedTests(output);
    const causes = clean ? [] : failureCauses(output);
    const skips = build ? [] : skipReasons(evidence.stdout);
    const state = build ? (clean ? 'passed' : 'failed')
      : !counts || counts.passed + counts.failed === 0 ? 'no_result'
        : row.exitCode !== 0 || counts.failed > 0 ? 'failed'
          : counts.skipped > 0 ? 'passed_with_skips' : 'passed';
    return {
      ...base, state, clean, counts, evidenceFile: row.evidenceFile,
      result: clean && build ? `Exit 0; ${entry.kind === 'near-build' ? 'verified WASM artifact' : 'clippy finished'}.` : failureSummary(entry, row, counts),
      // The report lists every cause, skip reason and failing test up to these caps; the totals say what was cut.
      causes: causes.slice(0, LISTED), causesTotal: causes.length, skipReasons: skips.slice(0, LISTED), skipReasonsTotal: skips.length,
      failedTests: failed.names, failedTestsTotal: failed.total, notes,
      // A suite that never reached its tests explains itself only in its last lines (an import error, a missing tool).
      outputTail: state === 'no_result' ? outputTail(evidence.stderr.trim() ? evidence.stderr : evidence.stdout) : [],
    };
  } catch {
    return { ...base, state: 'unverified', clean: false, counts: null, evidenceFile: typeof row.evidenceFile === 'string' ? row.evidenceFile : null, result: 'The recorded output of this run is missing or was altered, so its result cannot be shown.', causes: [], causesTotal: 0, skipReasons: [], skipReasonsTotal: 0, failedTests: [], failedTestsTotal: 0, notes: [], outputTail: [] };
  }
}

const SUITE_ORDER = ['unverified', 'no_result', 'failed', 'passed_with_skips', 'passed'];

// The report's Tests block: everything recorded about the target's own suites, one row per catalogued suite.
// These results are evidence about the target. They never decide whether a report is complete: that is the
// agents' review alone.
function testsBlock({ catalog, attempts, manifest, notes, read }) {
  const suites = (catalog?.tests || []).map((entry) => {
    const runs = attempts.filter(row => row.testId === entry.id && row.sourceDigest === manifest.digest).map(row => attemptOf(entry, row, read));
    // Several attempts of one suite are shown by the worst of them: a pass cannot conceal a failed run.
    const shown = runs.slice().sort((a, b) => SUITE_ORDER.indexOf(a.state) - SUITE_ORDER.indexOf(b.state))[0];
    const head = { id: entry.id, kind: entry.kind || null, cwd: entry.cwd || null, description: entry.description, attempts: runs.length };
    if (!shown) return { ...head, state: 'not_run', clean: false, exitCode: null, counts: null, at: null, durationMs: null, dependencies: null, evidenceFile: null, result: 'No execution of this suite was recorded for the captured source.', causes: [], causesTotal: 0, skipReasons: [], skipReasonsTotal: 0, failedTests: [], failedTestsTotal: 0, notes: [], outputTail: [] };
    return { ...head, ...shown, clean: runs.every(run => run.clean) };
  });
  const count = (...states) => suites.filter(suite => states.includes(suite.state)).length;
  const sum = (key) => suites.reduce((n, suite) => n + (suite.counts?.[key] || 0), 0);
  const totals = { suites: suites.length, passed: count('passed'), passedWithSkips: count('passed_with_skips'), failed: count('failed', 'no_result', 'unverified'), notRun: count('not_run'), tests: { passed: sum('passed'), failed: sum('failed'), skipped: sum('skipped') } };
  const state = !suites.length ? 'none' : totals.failed ? 'failed' : totals.notRun ? 'not_run' : totals.passedWithSkips ? 'passed_with_skips' : 'passed';
  return {
    state, totals, suites, notes,
    policy: 'These are the target project\'s own tests, run offline in the sandbox. They are evidence about the target and do not decide whether this report is complete.',
  };
}

export const TOOLS_POLICY = 'These are the audit\'s own scanners and sandbox record. Their results are leads for the reviewers; a scanner that failed or did not run is shown here and does not decide whether this report is complete.';
const SCANNER_OK = ['passed', 'findings', 'not_applicable'];

// One row per required scanner: missing (no row at all), failed (a row that is not a result), findings, passed or
// not_applicable. `detail` is the scanner's own reason for a failure (scanner-evidence.mjs killedDetail).
function scannerRow(tool, rows) {
  const bad = rows.filter(row => !SCANNER_OK.includes(row.state));
  const state = !rows.length ? 'missing' : bad.length ? 'failed' : rows.some(row => row.state === 'findings') ? 'findings' : rows.every(row => row.state === 'not_applicable') ? 'not_applicable' : 'passed';
  const counted = rows.filter(row => Number.isSafeInteger(row.findings));
  return {
    tool, state,
    findings: counted.length ? counted.reduce((n, row) => n + row.findings, 0) : null,
    scopes: [...new Set(rows.map(row => row.scope).filter(scope => typeof scope === 'string' && scope))].map(scope => scope.slice(0, 200)),
    // Runs before the scanners recorded a reason have only their output file.
    detail: bad.length ? String(bad.find(row => row.detail)?.detail || `No reason was recorded${typeof bad[0].evidenceFile === 'string' ? `; its output is in ${bad[0].evidenceFile}` : ''}.`).slice(0, 400) : null,
  };
}

// The report's Tools block. Like the Tests block it is shown on every report and never decides whether the report
// is complete: that is decided by the agents' review alone.
export function toolsBlock({ scanners = [], notes = [] } = {}) {
  const gaps = notes.length || scanners.some(row => ['failed', 'missing'].includes(row.state));
  return { state: gaps ? 'gaps' : 'passed', scanners, notes, policy: TOOLS_POLICY };
}

// What the run recorded about the target's own suites (`tests`) and the audit's own scanners (`tools`, with the
// legacy `gaps` and `scans`). Neither decides whether a report is complete; report-contract.mjs reads only the
// agents' outputs for that.
export function verificationHealth(root, read) {
  const gaps = [], suites = [], scans = [], testNotes = [], scanners = [], toolNotes = [];
  // A gap that no scanner row shows (the row itself says failed or missing) is also a note in the Tools block.
  const note = (text) => { gaps.push(text); toolNotes.push(text); };
  let manifest, catalog;
  try {
    manifest = read('source-manifest.json');
    catalog = read('harness/existing-tests.json');
    if (!Array.isArray(manifest.files) || catalog.sourceDigest !== manifest.digest || !Array.isArray(catalog.tests) || catalog.tests.some(entry => !entry || typeof entry.id !== 'string' || typeof entry.description !== 'string')) throw Error();
  } catch { catalog = null; testNotes.push('The existing-test catalog is missing or does not match the captured source, so no suite result can be shown.'); }
  const attempts = [];
  let files = [];
  try { files = fs.readdirSync(`${root}/harness`); } catch { testNotes.push('The test evidence directory is missing.'); }
  for (const name of files.filter(name => /^existing-test-results-[\w-]+\.json$/.test(name))) {
    try {
      const rows = read(`harness/${name}`);
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error();
      attempts.push(...rows);
    } catch { testNotes.push(`Invalid existing test evidence: ${name}.`); }
  }
  if (catalog && !catalog.tests.length) testNotes.push('No executable test suite was catalogued for this target.');
  for (const gap of Array.isArray(catalog?.coverageGaps) ? catalog.coverageGaps : []) {
    if (typeof gap === 'string' && gap.trim()) testNotes.push(gap);
  }
  const tests = testsBlock({ catalog, attempts, manifest, notes: testNotes, read });
  let notStarted = [];
  try { notStarted = read(TEST_PHASE_FILE); } catch { /* every suite was started */ }
  for (const row of Array.isArray(notStarted) ? notStarted : []) {
    const suite = tests.suites.find(item => item.id === row?.testId && item.state === 'not_run');
    if (suite && typeof row.note === 'string') suite.notes.push(row.note.slice(0, 400));
  }
  for (const suite of tests.suites) suites.push({ id: suite.id, state: suite.clean ? 'passed' : suite.attempts ? 'failed_or_unverified' : 'not_run', attempts: suite.attempts });
  try {
    const record = read('harness/scanner-results.json');
    if (record.version !== 1 || !Array.isArray(record.checks)) throw Error();
    const names = file => file.path.split('/').at(-1);
    const vendored = file => /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|target|\.next|harness-fixtures|reports|\.cargo|__pycache__|\.venv|venv|env|\.tox|site-packages)\//.test(file.path);
    const hasNode = manifest.files.some(file => names(file) === 'package.json' && !vendored(file));
    const hasPython = manifest.files.some(file => !vendored(file) && /^(?:requirements[\w.-]*\.(?:txt|in)|pyproject\.toml|Pipfile(?:\.lock)?|poetry\.lock|uv\.lock|pdm\.lock)$/.test(names(file)));
    const tools = ['gitleaks', 'semgrep', 'osv-scanner', 'cargo-audit', 'npm-audit', ...(hasPython ? ['python-deps'] : []), ...(hasNode ? ['node-deps'] : [])];
    for (const tool of tools) {
      const rows = record.checks.filter(row => row && row.tool === tool);
      scans.push(...rows);
      const row = scannerRow(tool, rows);
      scanners.push(row);
      if (row.state === 'missing') gaps.push(`${tool}: did not run; no result was recorded.`);
      if (row.state === 'failed') gaps.push(`${tool}: failed. ${row.detail}`);
      // Applicability is derived from the captured files, never a scanner's self-exemption.
      const locks = tool === 'cargo-audit' ? 'Cargo.lock' : tool === 'npm-audit' ? 'package-lock.json' : null;
      if (rows.some(row => row.state === 'not_applicable') && (!locks || manifest.files.some(file => file.path.split('/').at(-1) === locks))) note(`${tool}: invalid not-applicable claim.`);
      for (const row of rows.filter(row => ['passed', 'findings'].includes(row.state))) {
        if (!row.evidenceFile || !/^harness\/scanner-output-[\w-]+-\d+\.json$/.test(row.evidenceFile)) { note(`${tool}: scanner output evidence is missing.`); continue; }
        const evidence = read(row.evidenceFile);
        if (scannerEvidence(tool, evidence).state !== row.state) note(`${tool}: scanner output does not support its recorded status.`);
      }
    }
  } catch { note('Structured scanner evidence is missing or invalid.'); }
  return { state: gaps.length ? 'gaps' : 'passed', gaps, suites, scans, tests, tools: toolsBlock({ scanners, notes: toolNotes }), scope: 'captured_source_and_existing_tests', outsideScope: ['private source absent from the supplied snapshot', 'deployed program bytes and production configuration', 'live service behavior'], evidenceLimit: 'Test counts and scanner results are tool-reported; they do not prove vulnerability reproduction or attest model identity.' };
}

// A budget or cost stop that still submitted (or kept an earlier pass's submission) is complete.
// The same stop with no submission across any pass of that job is not.
export function budgetHealth(rows) {
  const budgetStops = [];
  const errors = [];
  const submittedJobs = new Set(rows.filter(r => r.submitted && r.job).map(r => r.job));
  for (const row of rows) {
    if (row.skipped) continue;
    const hasSubmission = Boolean(row.submitted || row.restored || (row.job && submittedJobs.has(row.job)));
    if ((row.stop === 'budget' || row.stop === 'cost') && hasSubmission) budgetStops.push(row);
    if ((row.stop === 'budget' || row.stop === 'cost') && !hasSubmission) errors.push(`${row.reviewer}: budget_exhausted_without_submission`);
  }
  return { state: errors.length ? 'INCOMPLETE' : 'COMPLETE', budgetStops, errors };
}
