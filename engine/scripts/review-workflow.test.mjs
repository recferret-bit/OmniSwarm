import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSnapshot, disposeSnapshot } from './worker-isolation.mjs';
import { REVIEW_WORKFLOW, REVIEW_TOOLS, NEAR_BUILD_ARTIFACT, EXISTING_TEST_RUNNER, buildExistingTestCatalog, evmTestGap, nearSandboxGap, selectExistingTest } from './review-workflow.mjs';
import { callBridgeTool, toolDefinitions } from './docker-mcp-bridge.mjs';
import { permissionDecision } from './agent-session.mjs';
import { auditToolDecision } from './audit-tool-policy.mjs';
import { runOrchestratedAudit } from './docker-agent-orchestrator.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-review-policy-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test existing.test.cjs', build: 'must never be offered' } }));
  fs.writeFileSync(path.join(root, 'existing.test.cjs'), '/* inert source only */');
  fs.writeFileSync(path.join(root, 'test.sh'), '#!/bin/sh\nexit 0\n');
  fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname="fixture"\nversion="0.1.0"\n');
  const snapshot = createSnapshot(root);
  const catalog = buildExistingTestCatalog(snapshot.snapshot, snapshot.manifest);
  disposeSnapshot(snapshot);
  fs.mkdirSync(path.join(root, 'harness'));
  fs.writeFileSync(path.join(root, 'harness/existing-tests.json'), JSON.stringify(catalog));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, catalog };
}

test('the fixed test catalog binds existing manifests and reconstructs commands without caller arguments', t => {
  const f = fixture(t);
  assert.equal(f.catalog.workflow, REVIEW_WORKFLOW);
  assert.deepEqual(f.catalog.tests.map(entry => entry.kind).sort(), ['cargo', 'npm', 'shell']);
  const entry = f.catalog.tests.find(test => test.kind === 'npm');
  const selected = selectExistingTest({ ...f.catalog, tests: [{ ...entry, command: 'sh', args: ['-c', 'unapproved'], timeoutMs: 999999999 }] }, entry.id, f.catalog.sourceDigest);
  assert.equal(selected.command, 'npm');
  assert.deepEqual(selected.args, ['--offline', '--ignore-scripts', 'run', 'test']);
  assert.equal(selected.timeoutMs, 900000);
  for (const runner of ['cargo', 'shell']) {
    const row = f.catalog.tests.find(test => test.kind === runner);
    assert.equal(selectExistingTest(f.catalog, row.id).timeoutMs, 900000);
  }
  for (const patch of [{ cwd: '../outside' }, { kind: 'node' }, { id: 'test-' + 'b'.repeat(24) }, { files: [{ path: '/outside', sha256: 'a'.repeat(64) }] }]) {
    const changed = { ...entry, ...patch };
    assert.throws(() => selectExistingTest({ ...f.catalog, tests: [changed] }, changed.id, f.catalog.sourceDigest));
  }
  assert.throws(() => selectExistingTest(f.catalog, entry.id, 'b'.repeat(64)));
});

test('old execution and PoC routes fail through direct MCP, AGY hooks and ACP permissions', async t => {
  const f = fixture(t);
  const options = [{ kind: 'allow_once', optionId: 'allow' }, { kind: 'reject_once', optionId: 'reject' }];
  for (const name of ['run_container_check', 'write_poc', 'get_attack_plan', 'bash', 'node']) {
    assert.equal(REVIEW_TOOLS.has(name), false);
    assert.ok(!toolDefinitions().some(tool => tool.name === name));
    await assert.rejects(callBridgeTool({ reportDir: f.root, dockerBin: '/must/not/execute' }, name, { command: 'node', args: ['-e', 'unapproved'] }), /Tool unavailable/);
    assert.equal(auditToolDecision({ toolCall: { name: 'call_mcp_tool', args: { ServerName: 'audit_docker', ToolName: name } } }).decision, 'deny');
    assert.equal(permissionDecision({ sessionId: 'own', options, toolCall: { _meta: { is_mcp_tool_call: true }, rawInput: { server: 'audit_docker', tool: name } } }, 'own').outcome.optionId, 'reject');
  }
});

test('test invocation rejects injected arguments and unknown IDs before Docker access', async t => {
  const f = fixture(t);
  const ctx = { reportDir: f.root, dockerBin: '/must/not/execute', submissionIdentity: { sourceDigest: f.catalog.sourceDigest } };
  const id = f.catalog.tests[0].id;
  for (const args of [{ test_id: id, args: ['--eval', 'unapproved'] }, { test_id: id, cwd: '/outside' }, { test_id: id, content: 'new test' }, { test_id: 'test-' + '0'.repeat(24) }]) await assert.rejects(callBridgeTool(ctx, 'run_existing_tests', args));
  const inventory = JSON.parse(await callBridgeTool(ctx, 'list_existing_tests'));
  assert.equal(inventory.tests.length, 3);
  assert.ok(inventory.tests.every(entry => !('command' in entry) && !('args' in entry)));
});

test('review reports require analysis and validation and reject exploit payload fields', async t => {
  const f = fixture(t);
  const ctx = { reportDir: f.root, role: 'auditor', auditor: 'claude-s1-auth', surface: 'S1', submissionIdentity: { name: 'claude-s1-auth', agent: 'claude', role: 'auditor', workflow: REVIEW_WORKFLOW, surface: 'S1', model: 'fixture', sourceDigest: f.catalog.sourceDigest, assignmentDigest: 'a'.repeat(64) } };
  const finding = { title: 'Inert review evidence', surface: 'S1', severity: 'info', confidence: 'probable', location: ['package.json:1'], impact: 'Fixture only', preconditions: 'None', analysis: 'Source inspection only', validation: 'No execution evidence', fix: 'Document the boundary' };
  for (const patch of [{ attack: ['unapproved instructions'] }, { poc: 'unapproved code' }, { analysis: '' }, { validation: '' }]) await assert.rejects(callBridgeTool(ctx, 'submit_audit_report', { findings: [{ ...finding, ...patch }], verified_safe: [] }));
  await callBridgeTool(ctx, 'submit_audit_report', { findings: [finding], verified_safe: [{ control: 'Inert fixture', evidence: ['package.json:1', 'package.json:2'], holds: true }] });
  const payload = JSON.parse(fs.readFileSync(path.join(f.root, 'auditors/claude-s1-auth.json')));
  assert.deepEqual(payload[0].attack, []);
  assert.equal(payload[0].poc, '');
  assert.equal(payload[0].analysis, finding.analysis);
  assert.equal(payload.at(-1).verified_safe[0].how_attacked, 'package.json:1; package.json:2');
});

test('legacy workflow sessions and deployed RPC requests are rejected before reviewer or Docker startup', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-workflow-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), prior = path.join(root, 'prior');
  fs.mkdirSync(source); fs.mkdirSync(prior);
  fs.writeFileSync(path.join(source, 'source.js'), 'export const inert = true;');
  const snapshot = createSnapshot(source);
  fs.writeFileSync(path.join(prior, 'source-manifest.json'), JSON.stringify(snapshot.manifest));
  disposeSnapshot(snapshot);
  fs.writeFileSync(path.join(prior, 'meta.json'), JSON.stringify({ surface: 's1', agents: ['codex'], models: { codex: 'fixture' } }));
  const request = { target: source, out: path.join(root, 'output'), surface: 's1', agents: ['codex'], models: { codex: 'fixture' }, resumeFrom: prior };
  const review = () => assert.fail('Rejected workflows must never launch a reviewer');
  await assert.rejects(runOrchestratedAudit(request, { review }), /Resume requires the same source digest/);
  await assert.rejects(runOrchestratedAudit({ ...request, rpc: 'https://example.invalid' }, { review }), /excludes deployed RPC/);
  await assert.rejects(runOrchestratedAudit({ ...request, resume: { conversationId: 'legacy' } }, { review }), /legacy adversarial-session/);
});

test('a near-sdk package and Intents npm tests are coverage gaps, not offline suites', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-review-near-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'other'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\nmembers = ["contracts", "other"]\n');
  fs.writeFileSync(path.join(root, 'contracts/Cargo.toml'), '[package]\nname = "c"\nversion = "0.1.0"\n\n[dependencies]\nnear-sdk = "5.29.0"\n');
  fs.writeFileSync(path.join(root, 'other/Cargo.toml'), '[package]\nname = "other"\nversion = "0.1.0"\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' }, dependencies: { '@defuse-protocol/one-click-sdk-typescript': '1.0.0' } }));
  const snapshot = createSnapshot(root);
  const catalog = buildExistingTestCatalog(snapshot.snapshot, snapshot.manifest);
  disposeSnapshot(snapshot);
  assert.deepEqual(catalog.tests.map((row) => `${row.kind}:${row.cwd}`), ['cargo:other']);
  assert.match(catalog.coverageGaps.join('\n'), /NEAR contract tests in \./);
  assert.match(catalog.coverageGaps.join('\n'), /NEAR contract tests in contracts/);
  assert.match(catalog.coverageGaps.join('\n'), /one-click-sdk-typescript/);
  assert.match(catalog.coverageGaps.join('\n'), /NEAR build verification unavailable in contracts: the near-sdk crate is not a cdylib contract/);
});

test('a near-sdk cdylib contract gets the fixed NEAR build checks and never an offline cargo test', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-review-near-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'tests/fixtures/near'), { recursive: true });
  const contract = '[package]\nname = "c"\nversion = "0.1.0"\n\n[lib]\ncrate-type = ["cdylib", "rlib"]\n\n[dependencies]\nnear-sdk = "5.29.0"\n';
  fs.writeFileSync(path.join(root, 'Cargo.toml'), contract);
  fs.writeFileSync(path.join(root, 'tests/fixtures/near/Cargo.toml'), contract);
  const snapshot = createSnapshot(root);
  const catalog = buildExistingTestCatalog(snapshot.snapshot, snapshot.manifest);
  disposeSnapshot(snapshot);
  // The fixture copy is not production source, so it gets no build check; neither directory gets cargo test.
  assert.deepEqual(catalog.tests.map((row) => `${row.kind}:${row.cwd}`), ['near-build:.', 'near-clippy:.']);
  assert.match(catalog.coverageGaps.join('\n'), /NEAR contract tests in \. are a local-sandbox coverage gap/);
  assert.doesNotMatch(catalog.coverageGaps.join('\n'), /NEAR build verification unavailable/);
  const build = selectExistingTest(catalog, catalog.tests[0].id, catalog.sourceDigest);
  assert.deepEqual([build.command, ...build.args], ['cargo', 'near', 'build', 'non-reproducible-wasm', '--locked', '--no-abi']);
  const clippy = selectExistingTest(catalog, catalog.tests[1].id, catalog.sourceDigest);
  assert.deepEqual([clippy.command, ...clippy.args], ['cargo', 'clippy', '--locked', '--offline', '--target', 'wasm32-unknown-unknown']);
  assert.equal(nearSandboxGap('.'), catalog.coverageGaps[0]);
});

// Runs EXISTING_TEST_RUNNER in a vm with a fake file system and a child that exits 0.
async function runnerWithFiles(entry, files) {
  const { default: vm } = await import('node:vm');
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const out = [], err = [];
  const isDir = (p) => Object.keys(files).some((f) => f.startsWith(`${p}/`));
  const fakeFs = {
    existsSync: (p) => p in files || isDir(p), realpathSync: (p) => p, lstatSync: () => ({ isFile: () => true, nlink: 1 }),
    readFileSync: (p) => { if (!(p in files)) throw Error('missing'); return files[p]; },
    statSync: () => ({ mtimeMs: Date.now() }),
    readdirSync: (p) => [...new Set(Object.keys(files).filter((f) => f.startsWith(`${p}/`)).map((f) => f.slice(p.length + 1).split('/')[0]))]
      .map((name) => ({ name, isSymbolicLink: () => false, isDirectory: () => isDir(`${p}/${name}`), isFile: () => `${p}/${name}` in files })),
  };
  const spawn = () => {
    const child = Object.assign(new EventEmitter(), { pid: 1, stdout: new PassThrough(), stderr: new PassThrough() });
    setImmediate(() => { child.stdout.end(); child.stderr.end(); child.emit('close', 0); });
    return child;
  };
  const proc = {
    env: { CARGO_TARGET_DIR: '/work/target' }, argv: ['node', '/work/src'], exitCode: undefined, kill() {},
    stdin: (async function* () { yield JSON.stringify(entry); })(), stdout: new PassThrough(), stderr: new PassThrough(),
  };
  proc.stdout.on('data', (c) => out.push(String(c)));
  proc.stderr.on('data', (c) => err.push(String(c)));
  // The runner sets process.exitCode in the child's close handler; wait for that, not for a fixed delay.
  const done = (async () => { for (let i = 0; i < 500 && proc.exitCode === undefined; i++) await new Promise((r) => setTimeout(r, 10)); })();
  vm.runInNewContext(EXISTING_TEST_RUNNER, {
    require: (name) => (name === 'node:fs' ? fakeFs : name === 'node:path' ? path : name === 'node:crypto' ? crypto : { spawn, spawnSync() {} }),
    process: proc, console: { log: (s) => out.push(`${s}\n`), error: (s) => err.push(`${s}\n`) }, setTimeout, clearTimeout,
  });
  await done;
  return { code: proc.exitCode, stdout: out.join(''), stderr: err.join('') };
}

test('the runner accepts a NEAR build only with a fresh WASM module and prints its digest', async () => {
  const entry = { kind: 'near-build', files: [], cwd: '.', command: 'cargo', args: ['near', 'build'], timeoutMs: 900000 };
  const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const built = await runnerWithFiles(entry, { '/work/target/near/demo_vault.wasm': wasm });
  assert.equal(built.code, 0, built.stderr);
  assert.match(built.stdout, NEAR_BUILD_ARTIFACT);
  assert.match(built.stdout, new RegExp(`demo_vault\\.wasm sha256 ${crypto.createHash('sha256').update(wasm).digest('hex')} bytes 8`));
  const none = await runnerWithFiles(entry, {});
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no WASM artifact was written/);
  const bogus = await runnerWithFiles(entry, { '/work/target/near/demo_vault.wasm': Buffer.from('not wasm') });
  assert.equal(bogus.code, 1);
  assert.doesNotMatch(bogus.stdout, NEAR_BUILD_ARTIFACT);
  // Any other kind keeps the child's exit status and is not checked for an artifact.
  assert.equal((await runnerWithFiles({ ...entry, kind: 'cargo' }, {})).code, 0);
});

test('a Python project with tests gets a fixed, hash-bound pytest entry and no caller-controlled interpreter', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-review-python-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'backend/tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend/requirements.txt'), 'fastapi==0.115.0\n');
  fs.writeFileSync(path.join(root, 'backend/tests/conftest.py'), '');
  fs.writeFileSync(path.join(root, 'backend/tests/test_a.py'), 'def test_a():\n    assert True\n');
  fs.writeFileSync(path.join(root, 'tools/test_orphan.py'), 'def test_b():\n    pass\n');
  const snapshot = createSnapshot(root);
  const catalog = buildExistingTestCatalog(snapshot.snapshot, snapshot.manifest);
  disposeSnapshot(snapshot);
  const rows = catalog.tests.filter(row => row.kind === 'pytest');
  assert.deepEqual(rows.map(row => row.cwd), ['backend']);
  assert.deepEqual(rows[0].files.map(file => file.path).sort(), ['backend/requirements.txt', 'backend/tests/conftest.py']);
  const selected = selectExistingTest({ ...catalog, tests: [{ ...rows[0], command: 'sh', args: ['-c', 'x'] }] }, rows[0].id, catalog.sourceDigest);
  assert.equal(selected.command, '/work/venv/bin/python');
  assert.deepEqual(selected.args, ['-m', 'pytest', '-p', 'no:cacheprovider', '-q', '--tb=line', '-rfEs', '--continue-on-collection-errors']);
  assert.equal(selected.timeoutMs, 1800000);
});

test('SBF discovery excludes NEAR even under Anchor and preserves actual Solana crates', async () => {
  const { default: vm } = await import('node:vm');
  const { EXISTING_TEST_RUNNER } = await import('./review-workflow.mjs');
  const manifest = dep => '[package]\nname="contract"\nversion="0.1.0"\n[lib]\ncrate-type=["cdylib"]\n' + dep;
  const files = {
    '/work/src/Anchor.toml': '',
    '/work/src/Cargo.toml': '[workspace]\nmembers=["near","solana"]\n[workspace.dependencies]\nsdk={package="near-sdk",version="5.29.0"}',
    '/work/src/near/Cargo.toml': manifest('[dependencies]\nsdk.workspace=true'),
    '/work/src/solana/Cargo.toml': manifest('[dependencies]\nanchor-lang="0.30.1"'),
  };
  const dirs = { '/work/src': ['Anchor.toml', 'Cargo.toml', 'near', 'solana'], '/work/src/near': ['Cargo.toml'], '/work/src/solana': ['Cargo.toml'] };
  const fakeFs = {
    existsSync: p => p in files || p in dirs || p === '/opt/platform-tools/rust/bin/cargo', realpathSync: p => p,
    readFileSync: p => { if (!(p in files)) throw Error('missing'); return files[p]; },
    readdirSync: p => (dirs[p] || []).map(name => ({ name, isSymbolicLink: () => false, isDirectory: () => path.join(p, name) in dirs, isFile: () => path.join(p, name) in files })),
  };
  const builds = [];
  const process = { env: {}, stdin: (async function* () { yield JSON.stringify({ files: [], cwd: '.', command: 'bash', args: ['./test.sh'], timeoutMs: 900000 }); })(), stderr: { write() {} } };
  await vm.runInNewContext(EXISTING_TEST_RUNNER, {
    require: name => name === 'node:fs' ? fakeFs : name === 'node:path' ? path : name === 'node:crypto' ? {} : { spawnSync: (command, args) => { builds.push(args.at(-1)); return { status: 1, stderr: 'inert mock' }; } },
    process, console: { error() {} }, setTimeout, clearTimeout,
  });
  assert.deepEqual(builds, ['/work/src/solana/Cargo.toml']);
});

test('Foundry and Hardhat contract tests are coverage gaps, and an ordinary npm suite beside them still runs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-review-evm-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('contracts/foundry.toml', '[profile.default]\n');
  put('contracts/lib/forge-std/foundry.toml', '[profile.default]\n');
  put('hh/package.json', JSON.stringify({ scripts: { test: 'hardhat test' }, devDependencies: { hardhat: '^2.22.0' } }));
  put('scripted/package.json', JSON.stringify({ scripts: { test: 'forge test -vvv' } }));
  put('api/package.json', JSON.stringify({ scripts: { test: 'node --test' }, dependencies: { ethers: '^6.13.0' } }));
  const snapshot = createSnapshot(root);
  const catalog = buildExistingTestCatalog(snapshot.snapshot, snapshot.manifest);
  disposeSnapshot(snapshot);
  // A package that only uses a client library is an ordinary offline npm suite.
  assert.deepEqual(catalog.tests.map((row) => `${row.kind}:${row.cwd}`), ['npm:api']);
  assert.deepEqual(catalog.coverageGaps.filter((gap) => gap.startsWith('EVM')).sort(), [evmTestGap('contracts', 'foundry'), evmTestGap('hh', 'hardhat'), evmTestGap('scripted', 'test script')].sort());
  // The vendored forge-std project is not a second gap.
  assert.equal(catalog.coverageGaps.some((gap) => gap.includes('lib/forge-std')), false);
});
