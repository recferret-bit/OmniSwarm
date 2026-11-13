import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { adapterOf, expectedAuditors, loadAuditors, validateAuditor, readReportText, writeReportFile } from './report-contract.mjs';
import { commitSubmission } from './audit-submission.mjs';
import { digest } from './agent-session-store.mjs';
import { loadAuditorFindings } from './crosscheck.mjs';
import { assignJobs } from './reviewer-plan-assign.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
// The engine (scripts/, skills/) sits in engine/; bin/audit and the .claude skill copy stay at the repository root.
const ENGINE_ROOT = path.resolve(scripts, '..');
const REPO_ROOT = path.resolve(ENGINE_ROOT, '..');
const finding = (extra = {}) => ({
  title: 'Review evidence label is overstated', surface: 'S1', severity: 'low',
  confidence: 'confirmed', location: ['src/report.ts:12'], impact: 'Report could mislead.',
  preconditions: 'Source review only', attack: [], poc: '', fix: 'Use an assertion label.', ...extra,
});

test('the dead crosscheck prepare CLI is gone', (t) => {
  const f = fixture(t);
  const r = spawnSync(process.execPath, [path.join(scripts, 'crosscheck.mjs'), 'prepare', f.dir, 'claude'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown command/);
  assert.equal(fs.existsSync(path.join(f.dir, 'crosscheck')), false);
});
const controls = { verified_safe: [] };
function fixture(t, agents = ['claude']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-report-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'auditors'));
  fs.mkdirSync(path.join(dir, 'harness'));
  fs.writeFileSync(path.join(dir, 'harness/sandbox.md'), '# Sandbox\n| fixture | impossible | Benign data fixture, no target execution. |\n');
  const meta = { agents, surface: 's1', models: { claude: 'requested-model' }, workerExits: {}, crosscheckExits: {}, stageFailures: [], finalized: true };
  const put = (rel, value) => fs.writeFileSync(path.join(dir, rel), JSON.stringify(value));
  const save = (adapter, data = [finding(), controls]) => {
    const name = `${adapter}-s1-auth`;
    meta.workerExits[name] = 0;
    put(`auditors/${name}.json`, data);
    fs.writeFileSync(path.join(dir, 'auditors', `${name}.md`), 'Source review only.\n');
    put('meta.json', meta);
  };
  put('meta.json', meta);
  const cross = () => {
    const { assignments } = loadAuditors(dir);
    for (const [adapter, ids] of Object.entries(assignments)) {
      meta.crosscheckExits[adapter] = 0;
      put(`auditors/crosscheck-${adapter}.json`, ids.map((id) => ({ id, verdict: 'upheld', reason: 'Source statement only.', evidence: ['src/report.ts:12'] })));
    }
    put('meta.json', meta);
  };
  return { dir, meta, put, save, cross };
}
const run = (file, dir) => spawnSync(process.execPath, [path.join(scripts, file), dir], { encoding: 'utf8', timeout: 10_000 });

test('valid empty findings still require the final controls object', () => {
  assert.deepEqual(validateAuditor([controls], 'claude-s1-auth'), [controls]);
  assert.throws(() => validateAuditor([], 'claude-s1-auth'));
});

test('strict schema rejects malformed evidence rather than salvaging it', () => {
  for (const extra of [{ title: 7 }, { confidence: 'possible' }, { severity: 'urgent' }, { location: ['../outside.ts:1'] }, { surface: 'S2' }, { attack: 'steps' }]) {
    assert.throws(() => validateAuditor([finding(extra), controls], 'claude-s1-auth'));
  }
  assert.throws(() => validateAuditor([{ findings: [] }], 'claude-s1-auth'));
  assert.throws(() => validateAuditor([{ verified_safe: [{ control: 'Review', how_attacked: 'Read', holds: 'true' }] }], 'claude-s1-auth'));
});

test('job names are exact: an unknown filename or a surface/slug mismatch names no reviewer', () => {
  assert.equal(adapterOf('claude-s1-auth'), 'claude');
  assert.equal(adapterOf('cli-codex-gpt-6-1-sol-s4-config'), 'cli-codex-gpt-6-1-sol');
  assert.equal(adapterOf('claude-s2-auth'), null);
  assert.equal(adapterOf('gpt-extra'), null);
  assert.equal(adapterOf('unrelated-grok-report'), null);
});

test('expected inventory follows single-surface and breadth-first contracts', () => {
  assert.deepEqual(expectedAuditors({ agents: ['claude', 'codex'], surface: 's1' }), ['claude-s1-auth', 'codex-s1-auth']);
  assert.deepEqual(expectedAuditors({ agents: ['claude'], surface: 'all' }), ['claude-s1-auth', 'claude-s2-input', 'claude-s3-logic', 'claude-s4-config', 'claude-s5-deps', 'claude-s6-client']);
  assert.deepEqual(expectedAuditors({ agents: ['claude', 'codex'], surface: 'all' }), ['claude-s1-auth', 'codex-s2-input', 'claude-s3-logic', 'codex-s4-config', 'claude-s5-deps', 'codex-s6-client']);
  assert.deepEqual(expectedAuditors({ agents: ['claude'], surface: 'nowhere' }), []);
});

test('W01-09: a matrix run over every surface validates every reviewer x surface job, not a round-robin subset', (t) => {
  const agents = ['cli-claude-opus', 'cli-codex-gpt-6-1-sol'];
  const reviewers = [
    { id: agents[0], family: 'cli', provider: 'claude', vendor: 'anthropic', model: 'opus' },
    { id: agents[1], family: 'cli', provider: 'codex', vendor: 'openai', model: 'gpt-6.1-sol' },
  ];
  const meta = { agents, reviewers, surface: 'all', assign: 'matrix' };
  const jobs = assignJobs({ reviewers, surfaceArg: 'all', assign: 'matrix' }).map((job) => job.name);
  assert.equal(jobs.length, 12);
  assert.deepEqual(expectedAuditors(meta), jobs, 'the contract derives the inventory with the launcher\'s own function');
  const f = fixture(t, agents);
  Object.assign(f.meta, { reviewers, surface: 'all', assign: 'matrix', auditors: jobs, models: { [agents[0]]: 'opus', [agents[1]]: 'gpt-6.1-sol' } });
  for (const name of jobs) {
    const surface = name.match(/-(s[1-6])-/)[1].toUpperCase();
    f.meta.workerExits[name] = 0;
    f.put(`auditors/${name}.json`, [finding({ surface, location: [`src/${name}.ts:3`], title: `Distinct claim ${name}` }), controls]);
    fs.writeFileSync(path.join(f.dir, 'auditors', `${name}.md`), 'Source review only.\n');
  }
  f.put('meta.json', f.meta);
  f.cross();
  const { health, reports } = loadAuditors(f.dir);
  assert.deepEqual(health.expected, jobs);
  assert.equal(reports.length, 12);
  assert.ok(!health.errors.some((e) => /inventory|unexpected auditor/.test(e)), health.errors.join('\n'));
  assert.equal(health.state, 'validated_outputs', health.errors.join('\n'));
  assert.equal(loadAuditorFindings(path.join(f.dir, 'auditors')).length, 12, 'every matrix job reaches cross-check');
  f.meta.assign = 'round-robin';
  f.put('meta.json', f.meta);
  assert.ok(loadAuditors(f.dir).health.errors.some((e) => /Declared auditor inventory does not match/.test(e)));
});

test('same-vendor reviewers owe no cross-check of each other, matching the orchestrator peer rule', (t) => {
  const agents = ['scripted-baseline', 'scripted-paranoid'];
  const reviewers = agents.map((id) => ({ id, family: 'scripted', provider: id.slice(9), vendor: 'scripted', model: id.slice(9) }));
  const f = fixture(t, agents);
  Object.assign(f.meta, { reviewers, models: { [agents[0]]: 'baseline', [agents[1]]: 'paranoid' } });
  for (const id of agents) f.save(id, [finding({ title: `Claim ${id}`, location: [`src/${id}.ts:3`] }), controls]);
  const { health } = loadAuditors(f.dir);
  assert.ok(!health.errors.some((e) => /cross-check/.test(e)), health.errors.join('\n'));
  assert.equal(health.state, 'validated_outputs', health.errors.join('\n'));
});

test('missing workers cannot become a complete zero-finding report', (t) => {
  const f = fixture(t, ['claude', 'grok']);
  f.save('claude', [controls]);
  assert.equal(loadAuditors(f.dir).health.state, 'incomplete');
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, 'report-health.json'))).state, 'incomplete');
});

test('cancelled cross-checks are not relabeled from historical MCP error prose', t => {
  const f = fixture(t, ['claude', 'grok']);
  f.save('claude'); f.save('grok'); f.cross();
  f.meta.crosscheckExits.grok = 130;
  f.put('meta.json', f.meta);
  fs.mkdirSync(path.join(f.dir, 'harness/host'));
  fs.writeFileSync(path.join(f.dir, 'harness/host/crosscheck-grok.log'), 'Historical audit_docker unavailable message.');
  const message = loadAuditors(f.dir).health.errors.find(error => error.startsWith('grok: missing or failed cross-check exit'));
  assert.match(message, /Review cancelled/);
  assert.doesNotMatch(message, /Docker MCP tools were unavailable/);
});

test('incomplete reports explain recorded policy refusals, MCP failures and timeouts', (t) => {
  const f = fixture(t, ['claude', 'grok', 'agy', 'codex']);
  fs.mkdirSync(path.join(f.dir, 'harness', 'host'));
  f.meta.workerExits = { 'claude-s1-auth': 1, 'grok-s1-auth': 1, 'agy-s1-auth': 124, 'codex-s1-auth': 1 };
  f.put('meta.json', f.meta);
  // R-07: the reasons are the structured ones the session recorded. Log text, here and in the forgeable /out, is not read.
  f.put('workers.json', { jobs: [{ name: 'claude-s1-auth', failure: { reason: 'usage_limit' } }, { name: 'grok-s1-auth', failure: { reason: 'mcp_unavailable' } }, { name: 'codex-s1-auth', failure: { reason: 'provider_policy' } }] });
  const health = loadAuditors(f.dir).health;
  assert.equal(health.state, 'incomplete');
  for (const expected of [/usage\/session limit/, /MCP tools were unavailable/, /exceeded its time budget/, /Provider refused/]) assert.ok(health.errors.some(error => expected.test(error)));
  const result = run('verify-and-adjudicate.mjs', f.dir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Provider refused/);
  f.put('workers.json', { jobs: [{ name: 'agy-s1-auth', failure: { reason: 'invalid_report', message: 'DO_NOT_TRUST_CUSTOM_TEXT' } }] });
  const diagnostics = loadAuditors(f.dir).health.errors.join('\n');
  assert.match(diagnostics, /Submitted report failed contract validation/);
  assert.ok(!diagnostics.includes('DO_NOT_TRUST_CUSTOM_TEXT'));
});

test('R-07: quota, refusal or MCP text in a log never decides a failure label', (t) => {
  const f = fixture(t, ['claude', 'grok']);
  fs.mkdirSync(path.join(f.dir, 'harness', 'host'));
  fs.mkdirSync(path.join(f.dir, 'harness', 'sandbox-run'));
  f.meta.workerExits = { 'claude-s1-auth': 1, 'grok-s1-auth': 1 };
  f.put('meta.json', f.meta);
  for (const dir of ['host', 'sandbox-run']) {
    fs.writeFileSync(path.join(f.dir, 'harness', dir, 'agent-claude-s1-auth.log'), "usage limit reached. You've hit your session limit. RESOURCE_EXHAUSTED");
    fs.writeFileSync(path.join(f.dir, 'harness', dir, 'agent-grok-s1-auth.log'), 'flagged for possible cybersecurity risk; The project MCP server never attached');
  }
  const errors = loadAuditors(f.dir).health.errors.join('\n');
  assert.match(errors, /Audit process exited unsuccessfully/);
  assert.doesNotMatch(errors, /usage\/session limit|Provider refused|MCP tools were unavailable/);
});

test('R-04: the report points at the host-only log, never at the container-writable /out', (t) => {
  const f = fixture(t, ['claude']);
  fs.mkdirSync(path.join(f.dir, 'harness', 'host'));
  f.meta.workerExits = { 'claude-s1-auth': 1 };
  f.put('meta.json', f.meta);
  fs.writeFileSync(path.join(f.dir, 'harness/host/agent-claude-s1-auth.log'), 'host log');
  const errors = loadAuditors(f.dir).health.errors.join('\n');
  assert.match(errors, /Log: harness\/host\/agent-claude-s1-auth\.log/);
  assert.doesNotMatch(errors, /sandbox-run/);
});

test('nonzero or absent worker exit remains incomplete with valid JSON', (t) => {
  const f = fixture(t);
  f.save('claude');
  f.meta.workerExits['claude-s1-auth'] = 1;
  f.put('meta.json', f.meta);
  assert.equal(loadAuditors(f.dir).health.state, 'incomplete');
  delete f.meta.workerExits;
  f.put('meta.json', f.meta);
  assert.equal(loadAuditors(f.dir).health.state, 'incomplete');
});

test('malformed metadata and report JSON fail closed', (t) => {
  const f = fixture(t);
  f.put('meta.json', null);
  assert.equal(loadAuditors(f.dir).health.state, 'incomplete');
  f.save('claude');
  fs.writeFileSync(path.join(f.dir, 'auditors/claude-s1-auth.json'), '{');
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 2);
});

test('missing markdown and unexpected files are coverage errors', (t) => {
  const f = fixture(t);
  f.save('claude');
  fs.unlinkSync(path.join(f.dir, 'auditors/claude-s1-auth.md'));
  assert.equal(loadAuditors(f.dir).reports.length, 0);
  f.save('claude');
  f.put('auditors/grok-extra.json', [finding(), controls]);
  assert.equal(loadAuditors(f.dir).health.state, 'incomplete');
  assert.equal(loadAuditorFindings(path.join(f.dir, 'auditors')).length, 1);
});

test('source-only confirmed claims never acquire POC execution status', (t) => {
  const f = fixture(t);
  f.save('claude');
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 0);
  const [row] = JSON.parse(fs.readFileSync(path.join(f.dir, 'findings-and-scores.json')));
  assert.equal(row.status, 'MODEL_ASSERTION');
  assert.equal(row.executionEvidence, 'not_collected');
  assert.deepEqual(row.claimIds, ['claude-s1-auth#0']);
});

test('same title at different locations does not manufacture agreement', (t) => {
  const f = fixture(t, ['claude', 'grok']);
  f.save('claude');
  f.save('grok', [finding({ location: ['src/other.ts:8'] }), controls]);
  f.cross();
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 0);
  const rows = JSON.parse(fs.readFileSync(path.join(f.dir, 'findings-and-scores.json')));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.status === 'UPHELD_REVIEW'));
});

test('matching model claims remain unverified agreement, not quorum proof', (t) => {
  const f = fixture(t, ['claude', 'grok']);
  f.save('claude');
  f.save('grok');
  f.cross();
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 0);
  const [row] = JSON.parse(fs.readFileSync(path.join(f.dir, 'findings-and-scores.json')));
  assert.equal(row.status, 'MODEL_AGREEMENT');
  assert.equal(row.provenance, 'unverified_adapter_identity');
});

test('differently titled claims on the same two files merge into one agreeing cluster', (t) => {
  const f = fixture(t, ['claude', 'grok']);
  f.save('claude', [finding({ location: ['src/a.ts:10', 'src/b.ts:20'] }), controls]);
  f.save('grok', [finding({ title: 'Other wording of the defect', location: ['src/a.ts:11', 'src/b.ts:19'] }), finding({ title: 'Unrelated', location: ['src/a.ts:90'] }), controls]);
  f.cross();
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 0);
  const rows = JSON.parse(fs.readFileSync(path.join(f.dir, 'findings-and-scores.json')));
  assert.equal(rows.length, 2);
  const merged = rows.find((r) => r.auditorCount === 2);
  assert.deepEqual([...merged.claimIds].sort(), ['claude-s1-auth#0', 'grok-s1-auth#0']);
  const health = JSON.parse(fs.readFileSync(path.join(f.dir, 'report-health.json')));
  assert.equal(health.dedup.rawClaims, 3);
  assert.equal(health.dedup.merged, 1);
  assert.equal(health.state, 'validated_outputs');
});

test('partial and empty cross-check verdict sets remain incomplete', (t) => {
  const f = fixture(t, ['claude', 'grok']);
  f.save('claude');
  f.save('grok');
  f.cross();
  f.put('auditors/crosscheck-grok.json', []);
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 2);
  f.cross();
  delete f.meta.finalized;
  f.put('meta.json', f.meta);
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 2);
});

test('peer authors can dispute individual claims inside an agreeing cluster', (t) => {
  const f = fixture(t, ['claude', 'grok']);
  f.save('claude');
  f.save('grok');
  f.cross();
  f.put('auditors/crosscheck-grok.json', [{ id: 'claude-s1-auth#0', verdict: 'refuted', reason: 'The source statement is disputed.', evidence: ['src/report.ts:12'] }]);
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 0);
  const [row] = JSON.parse(fs.readFileSync(path.join(f.dir, 'findings-and-scores.json')));
  assert.equal(row.status, 'PARTIAL_REVIEW');
  assert.ok(row.reviews.some((r) => r.claimId === 'claude-s1-auth#0' && r.verdict === 'refuted'));
});

test('cross-check enums and citations are strict', (t) => {
  const f = fixture(t, ['claude', 'grok']);
  f.save('claude');
  f.save('grok');
  for (const extra of [{ verdict: ['upheld'] }, { evidence: [''] }, { severity: ['low'] }]) {
    f.cross();
    f.put('auditors/crosscheck-grok.json', [{ id: 'claude-s1-auth#0', verdict: 'upheld', reason: 'Read.', evidence: ['src/report.ts:12'], ...extra }]);
    assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 2);
  }
});

test('metadata presentation errors still render an incomplete banner', (t) => {
  const f = fixture(t);
  for (const value of [null, { ...f.meta, date: 'not a date' }, { ...f.meta, name: 9, source: [], models: ['unexpected'] }]) {
    f.put('meta.json', value);
    assert.equal(run('generate-html-report.mjs', f.dir).status, 2);
    assert.match(fs.readFileSync(path.join(f.dir, 'report.html'), 'utf8'), /INCOMPLETE REVIEW/);
  }
});

test('bounded text reads reject oversize and non-regular entries', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'oversize.txt'), 'ordinary text');
  assert.throws(() => readReportText(f.dir, 'oversize.txt', 4));
  assert.throws(() => readReportText(f.dir, 'auditors'));
});

test('legacy tiebreak overrides are excluded, never elevated to confirmation', (t) => {
  const f = fixture(t);
  f.save('claude');
  f.put('auditors/tiebreak-old.json', [{ match: ['review'], verdict: 'upheld' }]);
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 2);
  const [row] = JSON.parse(fs.readFileSync(path.join(f.dir, 'findings-and-scores.json')));
  assert.equal(row.status, 'MODEL_ASSERTION');
});

test('unknown cross-check claims and missing expected cross-checks are incomplete', (t) => {
  const f = fixture(t, ['claude', 'grok']);
  f.save('claude');
  f.save('grok');
  f.put('auditors/crosscheck-grok.json', [{ id: 'unknown#0', verdict: 'upheld', reason: 'Read', evidence: ['src/report.ts:12'] }]);
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 2);
  fs.unlinkSync(path.join(f.dir, 'auditors/crosscheck-grok.json'));
  f.meta.crosscheckExits = { grok: 0 };
  f.put('meta.json', f.meta);
  assert.equal(run('verify-and-adjudicate.mjs', f.dir).status, 2);
});

test('renderer discloses unavailable outputs and sandbox coverage', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.dir, 'harness/sandbox.md'));
  assert.equal(run('generate-html-report.mjs', f.dir).status, 2);
  const html = fs.readFileSync(path.join(f.dir, 'report.html'), 'utf8');
  const chart = fs.readFileSync(path.join(f.dir, 'findings-by-model.html'), 'utf8');
  assert.match(html, /INCOMPLETE REVIEW/);
  assert.match(html, /Sandbox coverage unavailable or invalid/);
  assert.match(chart, /no valid outputs/);
  assert.doesNotMatch(html, /Quorum Security Review/);
});

// The user-facing rule: complete or incomplete is decided by the agents' review alone. The target's test suites,
// the audit's scanners and the sandbox record are shown in the Tests and Tools blocks and never change that flag.
test('complete reviewer outputs with no scanner record and no sandbox record are complete; Tools says what is missing', t => {
  const f = fixture(t);
  f.meta.workflow = 'source_security_review_v1';
  f.save('claude', [controls]);
  fs.unlinkSync(path.join(f.dir, 'harness/sandbox.md'));
  const rendered = run('generate-html-report.mjs', f.dir);
  assert.equal(rendered.status, 0, `${rendered.stdout}\n${rendered.stderr}`);
  const health = JSON.parse(fs.readFileSync(path.join(f.dir, 'report-health.json'), 'utf8'));
  assert.equal(health.state, 'validated_outputs');
  assert.deepEqual(health.errors, []);
  assert.deepEqual(health.incompletionNotes, []);
  assert.equal(health.tools.state, 'gaps');
  assert.deepEqual(health.tools.notes, ['Structured scanner evidence is missing or invalid.', 'Sandbox record (harness/sandbox.md) is missing or invalid, so which checks the sandbox ran is unknown.']);
  assert.match(rendered.stdout, /Tools \(the audit's own scanners; they do not decide whether this report is complete\):\n {2}No scanner result was recorded\. 2 notes\./);
  const html = fs.readFileSync(path.join(f.dir, 'report.html'), 'utf8');
  assert.doesNotMatch(html, /INCOMPLETE/);
  assert.match(html, /<details class="panel" id="tools"><summary><span class="pill orange">Tools<\/span>Tools/);
  assert.match(html, /<li>Sandbox record \(harness\/sandbox\.md\) is missing or invalid/);
});

test('a failing target suite is shown in the Tests block and does not make a validated report incomplete', t => {
  const f = fixture(t);
  f.meta.workflow = 'source_security_review_v1';
  f.save('claude', [controls]);
  const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  f.put('source-manifest.json', { digest: 'source', files: [{ path: 'src/report.ts' }] });
  f.put('harness/existing-tests.json', {
    version: 1, workflow: 'source_security_review_v1', sourceDigest: 'source',
    tests: [{ id: 'test-py', kind: 'pytest', cwd: 'backend', description: 'pytest existing tests in backend' }, { id: 'test-rs', kind: 'cargo', cwd: 'program', description: 'cargo existing tests in program' }],
    coverageGaps: ['EVM contract tests in evm (foundry) are not run: forge, hardhat and solc are not in the sandbox image and are not installed during a review.'],
  });
  const output = { stdout: 'FAILED tests/test_cash.py::test_start - AssertionError: bigint: Failed to load <bindings>\nFAILED tests/test_cash.py::test_claim - AssertionError: bigint: Failed to load <bindings>\n2 failed, 11768 passed, 500 skipped in 1036.86s (0:17:16)\n', stderr: '' };
  f.put('harness/existing-test-output-verification-0.json', output);
  f.put('harness/existing-test-results-verification.json', [{ testId: 'test-py', sourceDigest: 'source', kind: 'pytest', cwd: 'backend', exitCode: 1, durationMs: 1036860, dependencies: 'sealed', evidenceFile: 'harness/existing-test-output-verification-0.json', evidenceHash: sha(output), at: '2026-11-12T23:28:38.000Z' }]);
  const checks = [];
  for (const [tool, stdout] of [['gitleaks', '[]'], ['semgrep', '{"results":[],"errors":[]}'], ['osv-scanner', '{"results":[]}']]) {
    f.put(`harness/scanner-output-${tool}-0.json`, { code: 0, stdout });
    checks.push({ tool, state: 'passed', evidenceFile: `harness/scanner-output-${tool}-0.json` });
  }
  f.put('harness/scanner-results.json', { version: 1, checks: [...checks, { tool: 'cargo-audit', state: 'not_applicable' }, { tool: 'npm-audit', state: 'not_applicable' }] });

  const rendered = run('generate-html-report.mjs', f.dir);
  assert.equal(rendered.status, 0, `${rendered.stdout}\n${rendered.stderr}`);
  const health = JSON.parse(fs.readFileSync(path.join(f.dir, 'report-health.json'), 'utf8'));
  assert.equal(health.state, 'validated_outputs');
  assert.deepEqual(health.errors, []);
  assert.deepEqual(health.verification.gaps, []);
  assert.equal('tests' in health.verification, false, 'the Tests block is its own top-level block');
  assert.equal(health.tests.state, 'failed');
  assert.deepEqual(health.tests.suites.map((suite) => [suite.id, suite.state, suite.counts]), [['test-py', 'failed', { passed: 11768, failed: 2, skipped: 500 }], ['test-rs', 'not_run', null]]);
  assert.deepEqual(health.tests.notes, ['EVM contract tests in evm (foundry) are not run: forge, hardhat and solc are not in the sandbox image and are not installed during a review.']);
  assert.deepEqual(health.incompletionNotes, []);

  assert.match(rendered.stdout, /Tests \(the target project's own suites; they do not decide whether this report is complete\):/);
  assert.match(rendered.stdout, /- pytest existing tests in backend: failed\. Exit 1; 11768 passed, 2 failed or errored, 500 skipped\./);
  assert.match(rendered.stdout, /- cargo existing tests in program: not run\./);
  assert.doesNotMatch(`${rendered.stdout}${rendered.stderr}`, /INCOMPLETE/);

  const html = fs.readFileSync(path.join(f.dir, 'report.html'), 'utf8');
  assert.doesNotMatch(html, /INCOMPLETE VERIFICATION|INCOMPLETE REVIEW/);
  assert.match(html, /<details class="panel" id="tests"><summary><span class="pill orange">Tests<\/span>Tests<span class="meta-label">2 suites: 1 failed, 1 not run\. 11,768 tests passed, 2 failed or errored, 500 skipped\.<\/span>/);
  assert.match(html, /do not decide whether this report is complete/);
  assert.match(html, /<td>pytest existing tests in backend<\/td><td class="test-failed"><strong>failed<\/strong><\/td><td>11,768<\/td><td>2<\/td><td>500<\/td><td>1<\/td><td>17m 17s<\/td>/);
  assert.match(html, /<li>2× <code>AssertionError: bigint: Failed to load &lt;bindings&gt;<\/code><\/li>/);
  assert.match(html, /<li><code>tests\/test_cash\.py::test_start<\/code><\/li>/);
  assert.match(html, /Suites that are not run/);

  // A failed scanner does not make it incomplete either: it is shown in the Tools block.
  f.put('harness/scanner-output-semgrep-0.json', { code: 1, stdout: '', signal: 'SIGKILL', elapsedMs: 180004, timeoutMs: 180000 });
  f.put('harness/scanner-results.json', { version: 1, checks: [...checks.map((row) => (row.tool === 'semgrep' ? { tool: 'semgrep', state: 'failed', detail: 'Timed out: killed at its 180s limit before it finished.', evidenceFile: row.evidenceFile } : row)), { tool: 'cargo-audit', state: 'not_applicable' }, { tool: 'npm-audit', state: 'not_applicable' }] });
  const gapped = run('generate-html-report.mjs', f.dir);
  assert.equal(gapped.status, 0, `${gapped.stdout}\n${gapped.stderr}`);
  assert.doesNotMatch(`${gapped.stdout}${gapped.stderr}`, /INCOMPLETE/);
  assert.match(gapped.stdout, /Tools \(the audit's own scanners; they do not decide whether this report is complete\):\n {2}5 scanners: 2 passed, 2 not applicable, 1 failed\.\n {2}- gitleaks: passed\n {2}- semgrep: failed\. Timed out: killed at its 180s limit before it finished\./);
  const gappedHealth = JSON.parse(fs.readFileSync(path.join(f.dir, 'report-health.json'), 'utf8'));
  assert.equal(gappedHealth.state, 'validated_outputs');
  assert.deepEqual(gappedHealth.errors, []);
  assert.deepEqual(gappedHealth.verification.gaps, ['semgrep: failed. Timed out: killed at its 180s limit before it finished.']);
  assert.equal(gappedHealth.tools.state, 'gaps');
  assert.equal(gappedHealth.tests.state, 'failed');
  const gappedHtml = fs.readFileSync(path.join(f.dir, 'report.html'), 'utf8');
  assert.match(gappedHtml, /<td>semgrep<\/td><td class="tool-failed"><strong>failed<\/strong><\/td><td>—<\/td><td>—<\/td><td>Timed out: killed at its 180s limit before it finished\.<\/td>/);

  // A reviewer that delivered nothing still makes it incomplete: that is the agents' work.
  fs.unlinkSync(path.join(f.dir, 'auditors/claude-s1-auth.json'));
  const missing = run('generate-html-report.mjs', f.dir);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /INCOMPLETE: missing, failed or invalid review outputs/);
});

test('renderer displays benign SVG source inertly and remains offline', (t) => {
  const f = fixture(t);
  f.save('claude');
  fs.mkdirSync(path.join(f.dir, 'assets'));
  fs.writeFileSync(path.join(f.dir, 'assets/diagram.svg'), '<svg><text>ordinary diagram</text></svg>');
  assert.equal(run('generate-html-report.mjs', f.dir).status, 0);
  const html = fs.readFileSync(path.join(f.dir, 'report.html'), 'utf8');
  assert.doesNotMatch(html, /<svg>/);
  assert.match(html, /&lt;svg&gt;/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /<script nonce="/);
  assert.doesNotMatch(html, /onclick=|fonts\.googleapis/);
  assert.match(html, /unverified/);
  f.meta.isolation = { policy: 'report_finalization' };
  f.meta.recovery = { fromReport: '<prior-review>' };
  f.put('meta.json', f.meta);
  assert.equal(run('generate-html-report.mjs', f.dir).status, 0);
  const recovered = fs.readFileSync(path.join(f.dir, 'report.html'), 'utf8');
  assert.match(recovered, /Saved review finalization/);
  assert.match(recovered, /No new Docker container/);
  assert.match(recovered, /&lt;prior-review&gt;/);
});

test('renderer preserves original analysis and formats it without activating source markup', (t) => {
  const f = fixture(t);
  f.save('claude', [finding({
    analysis: '**Ownership control**\n\n- Check `wallet_id`.\n- Keep the original evidence.',
    validation: 'Source only. <img src=x onerror="alert(1)">',
    fix: 'Reject `<script>` in the rendered source.',
  }), controls]);
  assert.equal(run('generate-html-report.mjs', f.dir).status, 0);
  const html = fs.readFileSync(path.join(f.dir, 'report.html'), 'utf8');
  assert.match(html, /<strong>Ownership control<\/strong>/);
  assert.match(html, /<li>Check <code>wallet_id<\/code>\.<\/li>/);
  assert.match(html, /Keep the original evidence\./);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x|<script>/);
  const findingTags = html.match(/<details class="finding [^>]+>/g);
  assert.equal(findingTags.length, 1);
  assert.ok(findingTags.every(tag => !/\sopen(?:\s|=|>)/.test(tag)));
});

test('both skill copies stay identical and describe incomplete reviews', () => {
  const a = fs.readFileSync(path.join(ENGINE_ROOT, 'skills/security-audit/SKILL.md'), 'utf8');
  const b = fs.readFileSync(path.join(REPO_ROOT, '.claude/skills/security-audit/SKILL.md'), 'utf8');
  assert.equal(a, b);
  assert.match(a, /incomplete.*not zero-finding passes/);
  assert.match(a, /Normal permissions and prompt instructions are not containment/);
  const evals = JSON.parse(fs.readFileSync(path.join(ENGINE_ROOT, 'skills/security-audit/evals.json')));
  assert.equal(evals.mode, 'classification_only');
  assert.equal(evals.evals.length, 7);
  assert.deepEqual(evals.evals.map((e) => e.name).slice(3), ['audit-not-pentest', 'layer-separation', 'hold-position-on-evidence', 'evm-coverage-and-eoa']);
  assert.ok(evals.evals.every((e) => e.prompt.includes('do not run commands')));
});

test('legacy PoC entry points are unavailable', () => {
  for (const command of ['pocs', 'test']) {
    const result = spawnSync('bash', [path.join(REPO_ROOT, 'bin/audit'), command], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  }
  const help = spawnSync('bash', [path.join(REPO_ROOT, 'bin/audit'), 'help'], { encoding: 'utf8' });
  assert.doesNotMatch(help.stdout, /audit pocs|--pocs/);
  const sandbox = spawnSync('bash', [path.join(scripts, 'sandbox.sh'), '--pocs', REPO_ROOT], { encoding: 'utf8' });
  assert.notEqual(sandbox.status, 0);
  assert.match(sandbox.stderr, /unknown/);
});

test('host launchers do not supply permission-bypass flags', () => {
  const source = fs.readFileSync(path.join(scripts, 'orchestrate.sh'), 'utf8');
  assert.doesNotMatch(source, /--dangerously-skip-permissions|--always-approve/);
  assert.match(source, /output directory must be empty/);
});


test('ACP report validation requires the committed identity and rejects altered derived output', t => {
  const f = fixture(t);
  f.save('claude');
  f.meta.submissionAuthority = 'mcp_commit';
  f.put('meta.json', f.meta);
  assert.equal(loadAuditors(f.dir).health.state, 'incomplete');
  const name = 'claude-s1-auth';
  const assignment = { surface: 'S1' };
  const identity = { name, agent: 'claude', role: 'auditor', model: 'requested-model', sourceDigest: 'a'.repeat(64), assignmentDigest: digest(assignment), surface: 'S1' };
  fs.mkdirSync(path.join(f.dir, 'harness/identities'));
  fs.mkdirSync(path.join(f.dir, 'harness/assignments'));
  f.put(`harness/identities/${name}.json`, identity);
  f.put(`harness/assignments/${name}.json`, assignment);
  f.put('source-manifest.json', { digest: identity.sourceDigest });
  commitSubmission(f.dir, name, identity, [finding(), controls], 'Source only');
  assert.equal(loadAuditors(f.dir).health.state, 'validated_outputs');
  f.put(`auditors/${name}.json`, [controls]);
  assert.equal(loadAuditors(f.dir).health.state, 'incomplete');
  f.put(`auditors/${name}.json`, [finding(), controls]);
  f.put(`harness/assignments/${name}.json`, { surface: 'S2' });
  assert.equal(loadAuditors(f.dir).health.state, 'incomplete');
});

test('report writes are atomic: temp file then rename, no leftovers, links refused (R-13)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-atomic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeReportFile(dir, 'meta.json', '{"a":1}');
  const inode = fs.statSync(path.join(dir, 'meta.json')).ino;
  writeReportFile(dir, 'meta.json', '{"a":2}');
  assert.equal(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'), '{"a":2}');
  assert.notEqual(fs.statSync(path.join(dir, 'meta.json')).ino, inode, 'replaced by rename, not truncated in place');
  assert.deepEqual(fs.readdirSync(dir), ['meta.json']);
  fs.symlinkSync(path.join(dir, 'meta.json'), path.join(dir, 'link.json'));
  assert.throws(() => writeReportFile(dir, 'link.json', 'x'), /singly linked regular file/);
  fs.linkSync(path.join(dir, 'meta.json'), path.join(dir, 'hard.json'));
  assert.throws(() => writeReportFile(dir, 'hard.json', 'x'), /singly linked regular file/);
  assert.equal(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'), '{"a":2}');
  fs.mkdirSync(path.join(dir, 'adir'));
  assert.throws(() => writeReportFile(dir, 'adir', 'x'));
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')));
});

test('a report with submissions/ must declare mcp_commit authority (R-03)', (t) => {
  const f = fixture(t);
  f.save('claude');
  fs.mkdirSync(path.join(f.dir, 'submissions'));
  const { health } = loadAuditors(f.dir);
  assert.equal(health.state, 'incomplete');
  assert.ok(health.errors.some((e) => /claude-s1-auth: missing or invalid outputs/.test(e)));
});

test('new reviewer metadata is accepted next to the legacy shape, and a mismatched inventory is not', (t) => {
  const f = fixture(t, ['cli-claude-sonnet']);
  f.meta.models = { 'cli-claude-sonnet': 'sonnet' };
  f.meta.reviewers = [{ id: 'cli-claude-sonnet', family: 'cli', provider: 'claude', vendor: 'anthropic', model: 'sonnet' }];
  f.save('cli-claude-sonnet');
  let health = loadAuditors(f.dir).health;
  assert.deepEqual(health.expected, ['cli-claude-sonnet-s1-auth']);
  assert.deepEqual(health.accepted, ['cli-claude-sonnet-s1-auth']);
  assert.ok(!health.errors.some((e) => /inventory|metadata/.test(e)), health.errors.join('\n'));
  f.meta.reviewers[0].id = 'someone-else';
  f.put('meta.json', f.meta);
  health = loadAuditors(f.dir).health;
  assert.ok(health.errors.some((e) => /Invalid reviewer inventory/.test(e)));
});

test('R-02: the source digest the bridge recorded must match the sealed manifest, or the report is INCOMPLETE', (t) => {
  const f = fixture(t, ['claude']);
  f.save('claude');
  f.meta.sandboxHardening = 1;
  f.put('meta.json', f.meta);
  const files = [{ path: 'src/a.js', bytes: 3, sha256: 'a'.repeat(64) }, { path: 'src/b.js', bytes: 4, sha256: 'b'.repeat(64) }];
  const digest = list => crypto.createHash('sha256').update(JSON.stringify(list)).digest('hex');
  f.put('source-manifest.json', { version: 1, files, digest: digest(files) });
  const served = value => f.put('harness/source-read-digest.json', value);
  const errors = () => loadAuditors(f.dir).health.errors.filter(error => /SOURCE_DIGEST_MISMATCH/.test(error));
  assert.equal(errors().length, 1, 'reviewer output without any recorded /src read fails closed');
  served({ version: 1, digest: digest(files), files });
  assert.deepEqual(errors(), []);
  // A served subset is a different tree: the sandbox copy drops nothing the snapshot kept.
  served({ version: 1, digest: digest(files.slice(0, 1)), files: files.slice(0, 1) });
  assert.equal(errors().length, 1);
  // Tampered digest file: a changed file, an extra file, a digest that does not match its own list.
  served({ version: 1, digest: digest(files), files: [{ ...files[0], sha256: 'c'.repeat(64) }, files[1]] });
  assert.equal(errors().length, 1);
  assert.equal(loadAuditors(f.dir).health.state, 'incomplete');
  const extra = [...files, { path: 'src/evil.js', bytes: 1, sha256: 'd'.repeat(64) }];
  served({ version: 1, digest: digest(extra), files: extra });
  assert.equal(errors().length, 1);
  served({ version: 1, digest: 'e'.repeat(64), files });
  assert.equal(errors().length, 1);
  fs.writeFileSync(path.join(f.dir, 'harness/source-read-digest.json'), '{');
  assert.equal(errors().length, 1);
  // Reports from before this hardening carry no marker and are not judged by it.
  delete f.meta.sandboxHardening;
  f.put('meta.json', f.meta);
  assert.deepEqual(errors(), []);
});

test('W04-15: a budget stop without a submission reaches report health, and a budgeted run needs its budget record', (t) => {
  const f = fixture(t, ['claude']);
  f.save('claude');
  const budgetErrors = () => loadAuditors(f.dir).health.errors.filter((e) => e.startsWith('BUDGET:'));
  assert.deepEqual(budgetErrors(), [], 'legacy reports without budgets are not judged by it');
  f.put('harness/budget-health.json', { state: 'INCOMPLETE', budgetStops: [], errors: ['claude: budget_exhausted_without_submission'] });
  assert.deepEqual(budgetErrors(), ['BUDGET: claude: budget_exhausted_without_submission']);
  assert.equal(loadAuditors(f.dir).health.state, 'incomplete');
  f.put('harness/budget-health.json', { state: 'COMPLETE', budgetStops: [], errors: [] });
  assert.deepEqual(budgetErrors(), []);
  f.put('harness/budget-health.json', { state: 'INCOMPLETE', errors: [] });
  assert.equal(budgetErrors().length, 1);
  fs.rmSync(path.join(f.dir, 'harness/budget-health.json'));
  Object.assign(f.meta, { budgets: { passes: 2, toolBudget: 5 }, submissionAuthority: 'mcp_commit' });
  f.put('meta.json', f.meta);
  fs.mkdirSync(path.join(f.dir, 'submissions'));
  assert.deepEqual(budgetErrors(), ['BUDGET: harness/budget-health.json is missing or unreadable.']);
});

test('meta.reviewers may carry the observed key fingerprint and served model, nothing else', (t) => {
  const f = fixture(t, ['nearai-deepseek-ai-deepseek-v4']);
  f.meta.models = { 'nearai-deepseek-ai-deepseek-v4': 'deepseek-ai/DeepSeek-V4' };
  f.meta.reviewers = [{ id: 'nearai-deepseek-ai-deepseek-v4', family: 'nearai', provider: 'nearai', vendor: 'deepseek', model: 'deepseek-ai/DeepSeek-V4', keyFingerprint: 'ab12cd34', servedModel: 'deepseek-ai/DeepSeek-V4' }];
  f.save('nearai-deepseek-ai-deepseek-v4');
  const inventory = () => loadAuditors(f.dir).health.errors.filter((e) => /Invalid reviewer inventory/.test(e));
  assert.deepEqual(inventory(), []);
  for (const bad of [{ keyFingerprint: 'sk-full-key-value' }, { servedModel: '' }, { apiKey: 'x' }]) {
    f.meta.reviewers = [{ id: 'nearai-deepseek-ai-deepseek-v4', family: 'nearai', provider: 'nearai', vendor: 'deepseek', model: 'deepseek-ai/DeepSeek-V4', ...bad }];
    f.put('meta.json', f.meta);
    assert.equal(inventory().length, 1, JSON.stringify(bad));
  }
});
