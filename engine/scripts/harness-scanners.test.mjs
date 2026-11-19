import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAllScanners, runCmd, scannerChecks, semgrepConfigArgs, semgrepTimeoutMs, setScannerOutputDir } from './harness-scanners.mjs';
import { scannerEvidence } from './scanner-evidence.mjs';

function writeShim(binDir, name, body) {
  const file = path.join(binDir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
}

test('runAllScanners executes cargo-audit, npm-audit, gitleaks, semgrep, and osv-scanner in parallel while committing deterministic scannerChecks order', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-scanners-parallel-'));
  const origEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CARGO_HOME: process.env.CARGO_HOME,
  };
  t.after(() => {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const target = path.join(root, 'target');
  const outDir = path.join(root, 'out');
  const binDir = path.join(root, 'bin');
  const homeDir = path.join(root, 'home');
  const cargoHome = path.join(root, 'cargo-home');
  const barrierFile = path.join(root, 'barrier.log');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.join(cargoHome, 'advisory-db'), { recursive: true });

  // Pre-seed cached gitleaks config (> 1000 bytes) so gitleaksConfig() stays 100% offline
  const gitleaksCacheDir = path.join(homeDir, '.cache', 'omniswarm-audit');
  fs.mkdirSync(gitleaksCacheDir, { recursive: true });
  fs.writeFileSync(path.join(gitleaksCacheDir, 'gitleaks-8.18.0.toml'), `${'# trusted gitleaks rules\n'.repeat(60)}`);

  // Minimal lockfiles & package.json so cargo-audit, npm-audit, and node-deps are all active
  fs.writeFileSync(path.join(target, 'Cargo.lock'), '# lock\nversion = 3\n');
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { leftpad: '1.0.0' } }));
  fs.writeFileSync(path.join(target, 'package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: {} }));
  fs.writeFileSync(barrierFile, '');

  // Shared barrier helper injected into each scanner shim:
  // Every scan invocation appends its tool name to barrier.log and waits (up to 3s) for all 5 scanners
  // to be running concurrently, then sleeps a staggered reverse delay so osv-scanner finishes FIRST and cargo-audit LAST.
  const barrierPrelude = (toolName, reverseDelayMs) => `
import fs from 'node:fs';
const args = process.argv.slice(2);
const barrier = ${JSON.stringify(barrierFile)};
async function waitAllFive() {
  fs.appendFileSync(barrier, '${toolName}\\n');
  const deadline = Date.now() + 3000;
  let sawAll = false;
  while (Date.now() < deadline) {
    const started = new Set(fs.readFileSync(barrier, 'utf8').split(/\\r?\\n/).filter(Boolean));
    if (started.size >= 5) { sawAll = true; break; }
    await new Promise((r) => setTimeout(r, 15));
  }
  if (!sawAll) {
    process.stderr.write('Sequential execution detected: not all 5 scanners started concurrently\\n');
    process.exit(99);
  }
  await new Promise((r) => setTimeout(r, ${reverseDelayMs}));
}
`;

  writeShim(binDir, 'cargo-audit', `${barrierPrelude('cargo-audit', 100)}
if (args.includes('--version')) { console.log('cargo-audit 0.21.0'); process.exit(0); }
await waitAllFive();
console.log(JSON.stringify({ vulnerabilities: { list: [] } }));
`);

  writeShim(binDir, 'npm', `${barrierPrelude('npm-audit', 80)}
if (args.includes('--version')) { console.log('10.8.0'); process.exit(0); }
await waitAllFive();
console.log(JSON.stringify({ metadata: { vulnerabilities: {} }, vulnerabilities: {} }));
`);

  writeShim(binDir, 'gitleaks', `${barrierPrelude('gitleaks', 60)}
if (args[0] === 'version') { console.log('8.18.0'); process.exit(0); }
await waitAllFive();
const reportIdx = args.indexOf('--report-path');
if (reportIdx !== -1 && args[reportIdx + 1]) fs.writeFileSync(args[reportIdx + 1], '[]');
console.log('[]');
`);

  writeShim(binDir, 'semgrep', `${barrierPrelude('semgrep', 30)}
if (args.includes('--version')) { console.log('1.99.0'); process.exit(0); }
await waitAllFive();
console.log(JSON.stringify({ version: '1.99.0', results: [], errors: [] }));
`);

  writeShim(binDir, 'osv-scanner', `${barrierPrelude('osv-scanner', 5)}
if (args.includes('--version')) { console.log('osv-scanner 1.9.0'); process.exit(0); }
await waitAllFive();
console.log(JSON.stringify({ results: [] }));
`);

  process.env.PATH = `${binDir}${path.delimiter}${origEnv.PATH || ''}`;
  process.env.HOME = homeDir;
  process.env.CARGO_HOME = cargoHome;

  setScannerOutputDir(outDir);
  const { deps, tools } = await runAllScanners(target, outDir);

  const startedTools = fs.readFileSync(barrierFile, 'utf8').split(/\r?\n/).filter(Boolean);
  assert.equal(new Set(startedTools).size, 5, 'All 5 read-only scanners must launch concurrently');

  // Despite reverse completion delays (osv-scanner fastest, cargo-audit slowest),
  // scannerChecks and evidenceFile indices must be 100% deterministic!
  assert.deepEqual(
    scannerChecks.map((row) => ({ tool: row.tool, state: row.state, evidenceFile: row.evidenceFile || null })),
    [
      { tool: 'cargo-audit', state: 'passed', evidenceFile: 'harness/scanner-output-cargo-audit-0.json' },
      { tool: 'npm-audit', state: 'passed', evidenceFile: 'harness/scanner-output-npm-audit-1.json' },
      { tool: 'node-deps', state: 'passed', evidenceFile: 'harness/scanner-output-node-deps-2.json' },
      { tool: 'python-deps', state: 'not_applicable', evidenceFile: null },
      { tool: 'gitleaks', state: 'passed', evidenceFile: 'harness/scanner-output-gitleaks-4.json' },
      { tool: 'semgrep', state: 'passed', evidenceFile: 'harness/scanner-output-semgrep-5.json' },
      { tool: 'osv-scanner', state: 'passed', evidenceFile: 'harness/scanner-output-osv-scanner-6.json' },
    ],
  );
  assert.match(deps, /## cargo-audit Cargo\.lock \(exit 0\)/);
  assert.match(deps, /## npm audit package-lock\.json \(exit 0\)/);
  assert.match(tools, /## gitleaks \(exit 0\)/);
  assert.match(tools, /## semgrep pinned upstream OWASP, Solidity and NEAR security rules \(exit 0\)/);
  assert.match(tools, /## osv-scanner \(exit 0\)/);
});

test('runAllScanners serializes dual osv-scanner invocations on polyglot Python repos so XDG_CACHE_HOME never races while keeping other scanners concurrent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-scanners-py-osv-'));
  const origEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CARGO_HOME: process.env.CARGO_HOME,
    OMNI_RESOLVED_PYTHON_REQS: process.env.OMNI_RESOLVED_PYTHON_REQS,
  };
  t.after(() => {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const target = path.join(root, 'target');
  const outDir = path.join(root, 'out');
  const binDir = path.join(root, 'bin');
  const homeDir = path.join(root, 'home');
  const cargoHome = path.join(root, 'cargo-home');
  const resolvedReqs = path.join(root, 'resolved-requirements.txt');
  const osvLock = path.join(root, 'osv-active.lock');
  const osvTrace = path.join(root, 'osv-trace.log');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.join(cargoHome, 'advisory-db'), { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.cache', 'omniswarm-audit'), { recursive: true });
  fs.writeFileSync(path.join(homeDir, '.cache', 'omniswarm-audit', 'gitleaks-8.18.0.toml'), `${'# gitleaks\n'.repeat(120)}`);

  // Unpinned Python requirements + pre-resolved requirements file triggers BOTH osv-scanner invocations
  fs.writeFileSync(path.join(target, 'requirements.txt'), 'flask>=2.0\n');
  fs.writeFileSync(resolvedReqs, 'flask==3.0.0\n');

  writeShim(binDir, 'gitleaks', `
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'version') { console.log('8.18.0'); process.exit(0); }
const reportIdx = args.indexOf('--report-path');
if (reportIdx !== -1 && args[reportIdx + 1]) fs.writeFileSync(args[reportIdx + 1], '[]');
console.log('[]');
`);
  writeShim(binDir, 'semgrep', `
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('1.99.0'); process.exit(0); }
console.log(JSON.stringify({ version: '1.99.0', results: [], errors: [] }));
`);
  writeShim(binDir, 'osv-scanner', `
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('osv-scanner 1.9.0'); process.exit(0); }
const lock = ${JSON.stringify(osvLock)};
const trace = ${JSON.stringify(osvTrace)};
if (fs.existsSync(lock)) {
  process.stderr.write('Concurrent osv-scanner race detected!\\n');
  process.exit(88);
}
fs.writeFileSync(lock, String(process.pid));
fs.appendFileSync(trace, (args.includes('-L') ? 'py-resolved' : 'root-scan') + '\\n');
await new Promise((r) => setTimeout(r, 40));
fs.rmSync(lock, { force: true });
console.log(JSON.stringify({ results: [] }));
`);

  process.env.PATH = `${binDir}${path.delimiter}${origEnv.PATH || ''}`;
  process.env.HOME = homeDir;
  process.env.CARGO_HOME = cargoHome;
  process.env.OMNI_RESOLVED_PYTHON_REQS = resolvedReqs;

  setScannerOutputDir(outDir);
  await runAllScanners(target, outDir);

  const osvCalls = fs.readFileSync(osvTrace, 'utf8').trim().split(/\r?\n/);
  assert.deepEqual(osvCalls, ['py-resolved', 'root-scan'], 'Both osv-scanner scans must complete without overlapping');
  assert.equal(scannerChecks.filter((r) => r.tool === 'osv-scanner' && r.state === 'passed').length, 2);
});

test('a scanner that outlives its time limit is recorded as timed out, and semgrep gets the lead scan\'s time', async () => {
  const slow = await runCmd(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], os.tmpdir(), 150, { PATH: process.env.PATH });
  assert.equal(slow.code, 1);
  assert.equal(slow.signal, 'SIGKILL');
  assert.equal(slow.timeoutMs, 150);
  assert.ok(slow.elapsedMs >= 150, `ran ${slow.elapsedMs}ms`);
  assert.match(scannerEvidence('semgrep', slow).detail, /^Timed out: killed at its 0s limit/);
  const quick = await runCmd(process.execPath, ['-e', 'process.stdout.write("[]")'], os.tmpdir(), 30_000, { PATH: process.env.PATH });
  assert.deepEqual(quick, { code: 0, stdout: '[]', stderr: '' });

  // Semgrep needs close to three minutes for 3,000 files on two CPUs; a fixed 180s killed it on a busy host.
  assert.equal(semgrepTimeoutMs({}), 15 * 60_000);
  assert.equal(semgrepTimeoutMs({ AUDIT_HARNESS_BUDGET_MS: String(20 * 60_000) }), 19 * 60_000);
  assert.equal(semgrepTimeoutMs({ AUDIT_HARNESS_BUDGET_MS: '15000' }), 30_000);
  assert.equal(semgrepTimeoutMs({ AUDIT_HARNESS_BUDGET_MS: 'nonsense' }), 15 * 60_000);
});

test('semgrepConfigArgs avoids duplicate NEAR rule IDs when bundled and validates curated NEAR SAST rules', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-semgrep-near-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nearRules = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docker/semgrep-near-rules.yaml');
  assert.equal(fs.existsSync(nearRules), true);

  const legacyBundle = path.join(dir, 'legacy-rules.yaml');
  fs.writeFileSync(legacyBundle, 'rules:\n  - id: solidity.tx-origin\n');
  assert.deepEqual(semgrepConfigArgs(legacyBundle, [nearRules]), [`--config=${legacyBundle}`, `--config=${nearRules}`]);

  const mergedBundle = path.join(dir, 'merged-rules.yaml');
  fs.writeFileSync(mergedBundle, 'rules:\n  - id: near.security.rust.ecrecover-malleable-signature\n');
  assert.deepEqual(semgrepConfigArgs(mergedBundle, [nearRules]), [`--config=${mergedBundle}`]);

  const hasRealSemgrep = spawnSync('which', ['semgrep'], { encoding: 'utf8' }).status === 0;
  if (!hasRealSemgrep) return;

  const val = spawnSync('semgrep', ['scan', '--validate', `--config=${nearRules}`, '--metrics=off', '--disable-version-check'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(val.status, 0, val.stderr);

  fs.writeFileSync(path.join(dir, 'bad.rs'), [
    'use near_sdk::env::{ecrecover, ed25519_verify};',
    'use near_sdk::{env, near, require, AccountId, NearToken, Promise};',
    '#[near]',
    'impl Vault {',
    '  pub fn bad(&mut self, h: [u8; 32], s: [u8; 64], pk: [u8; 32], memo: String) {',
    '    let _ = ecrecover(&h, &s, 0, false);',
    '    ed25519_verify(&s, &h, &pk);',
    '    require!(',
    '      env::signer_account_id() == self.owner,',
    '      "owner"',
    '    );',
    '    let caller = env::signer_account_id();',
    '    require!(caller == self.owner, "owner2");',
    '    let _ = env::promise_result(0);',
    '    Promise::new(self.owner.clone()).use_global_contract_by_account_id(self.owner.clone());',
    '    env::log_str(&format!("EVENT_JSON:{{\\"standard\\":\\"nep141\\",\\"memo\\":\\"{memo}\\"}}"));',
    '  }',
    '  pub fn reclaim(&mut self, k: AccountId) -> Promise {',
    '    let before = env::storage_usage();',
    '    self.m.remove(&k);',
    '    let _ = before;',
    '    Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(1))',
    '  }',
    '  pub fn reclaim_local(&mut self, k: AccountId) -> Promise {',
    '    let caller = env::predecessor_account_id();',
    '    let freed = u128::from(self.saved_storage - env::storage_usage());',
    '    let _ = k;',
    '    Promise::new(caller).transfer(NearToken::from_yoctonear(freed))',
    '  }',
    '}',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'good.rs'), [
    'use near_sdk::{env, near, require, AccountId, NearToken, Promise};',
    '#[near]',
    'impl Vault {',
    '  pub fn good(&mut self, h: [u8; 32], s: [u8; 64], pk: [u8; 32], code_hash: Vec<u8>, payer: AccountId) -> Promise {',
    '    let _ = env::ecrecover(&h, &s, 0, true);',
    '    require!(env::ed25519_verify(&s, &h, &pk), "bad sig");',
    '    require!(env::predecessor_account_id() == self.owner, "owner");',
    '    let _ = env::promise_result_checked(0, 1024);',
    '    let before = env::storage_usage();',
    '    let _ = before;',
    '    Promise::new(self.owner.clone()).use_global_contract(code_hash).then(Promise::new(payer).transfer(NearToken::from_yoctonear(1)))',
    '  }',
    '  #[payable]',
    '  pub fn nft_mint(&mut self, id: String) {',
    '    let initial = env::storage_usage();',
    '    self.m.insert(&id, &env::predecessor_account_id());',
    '    let cost = u128::from(env::storage_usage() - initial) * env::storage_byte_cost().as_yoctonear();',
    '    let attached = env::attached_deposit().as_yoctonear();',
    '    require!(attached >= cost, "deposit");',
    '    let excess = attached - cost;',
    '    if excess > 0 {',
    '      Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(excess));',
    '    }',
    '  }',
    '}',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'bad.ts'), 'const a = near.signerAccountId() === owner;\nconst b = process.env.DSTACK_SIMULATOR_ENDPOINT;\nconst c = import.meta.env.VITE_NEARAI_API_KEY;\n');
  fs.writeFileSync(path.join(dir, 'good.ts'), 'const a = near.predecessorAccountId() === owner;\nconst b = "/var/run/dstack.sock";\nconst c = process.env.NEARAI_API_KEY;\n');
  fs.writeFileSync(path.join(dir, 'bad.py'), 'import os\nsim = os.environ.get("DSTACK_SIMULATOR_ENDPOINT", "/var/run/dstack.sock")\n');
  fs.writeFileSync(path.join(dir, 'good.py'), 'SOCK = "/var/run/dstack.sock"\n');

  const scan = spawnSync('semgrep', ['scan', '--metrics=off', '--disable-version-check', '--json', `--config=${nearRules}`, dir], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(scan.status, 0, scan.stderr);
  const parsed = JSON.parse(scan.stdout);
  assert.deepEqual(parsed.errors, []);
  const hitFiles = new Set(parsed.results.map((r) => path.basename(r.path)));
  assert.deepEqual([...hitFiles].sort(), ['bad.py', 'bad.rs', 'bad.ts']);
  assert.equal(parsed.results.length, 13);
});
