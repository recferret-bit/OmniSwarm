// W02 regression test: a hostile fixture whose own suite attacks the sandbox runs through the real sandbox
// (sandbox.sh --review-only, the local audit-sandbox:local image, no network pulls) and the real bridge, and the six
// invariants in scripts/harness-fixtures/hostile/expected.json must hold afterwards. Reviewer calls are scripted
// callBridgeTool calls; no model is involved.
// Needs Docker and the local images audit-sandbox:local and node:24-bookworm-slim; it never pulls or builds one.
// Run: npm run test:docker -- --test-name-pattern hardening
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSnapshot, disposeSnapshot } from './worker-isolation.mjs';
import { buildExistingTestCatalog } from './review-workflow.mjs';
import { callBridgeTool, execInContainer, resolveDockerBin } from './docker-mcp-bridge.mjs';
import { startOneShotDocker } from './docker-agent-orchestrator.mjs';
import { classifyAuditFailure } from './audit-process.mjs';
import { readReportJson, readReportText, sourceReadDigestProblem, writeReportFile } from './report-contract.mjs';
import { HOST_DIR, hostLogRel } from './sandbox-host-paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, 'harness-fixtures', 'hostile');
const expected = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'expected.json'), 'utf8'));
const dockerBin = resolveDockerBin();
const docker = args => spawnSync(dockerBin, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
const imagesPresent = ['audit-sandbox:local', 'node:24-bookworm-slim'].every(image => docker(['image', 'inspect', image]).status === 0);
const invariant = id => expected.invariants.find(row => row.id === id);

test('hardening: the hostile fixture cannot influence what reviewers see (six invariants)', { skip: imagesPresent ? false : 'local images audit-sandbox:local and node:24-bookworm-slim are required' }, async t => {
  assert.equal(expected.invariants.length, 6);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-hostile-'));
  const report = path.join(root, 'report');
  fs.mkdirSync(path.join(report, 'harness'), { recursive: true });
  const savedFast = process.env.SANDBOX_FAST;
  process.env.SANDBOX_FAST = '1'; // use the preprovisioned image; sandbox.sh must not build one
  const snapshot = createSnapshot(fixtureDir, { only: ['package.json', 'attack.test.cjs', 'src', 'src/lib.js'] });
  let session;
  t.after(async () => {
    if (session) await session.stop();
    disposeSnapshot(snapshot);
    if (savedFast === undefined) delete process.env.SANDBOX_FAST; else process.env.SANDBOX_FAST = savedFast;
    fs.rmSync(root, { recursive: true, force: true });
  });
  writeReportFile(report, 'source-manifest.json', JSON.stringify(snapshot.manifest, null, 2));
  session = await startOneShotDocker({ target: snapshot.snapshot, out: report });
  const { container } = session;
  const catalog = buildExistingTestCatalog(snapshot.snapshot, snapshot.manifest);
  writeReportFile(report, 'harness/existing-tests.json', JSON.stringify(catalog));
  const entry = catalog.tests.find(row => row.kind === 'npm');
  assert.ok(entry, 'the hostile package has a catalogued npm test');
  const ctx = { dockerBin, container, reportDir: report, role: 'auditor', auditor: 'verification', surface: 'S1' };
  const reviewer = { ...ctx, auditor: 'claude-s1-auth' };
  const exec = async script => (await execInContainer(dockerBin, container, ['/usr/local/bin/node', '-e', script], { cwd: '/' })).stdout;
  const sh = async command => (await execInContainer(dockerBin, container, ['/bin/sh', '-c', command], { cwd: '/' })).stdout.trim();

  // The coordinator's run of the catalogued suite: this is where the hostile suite executes its five attacks.
  const run = await callBridgeTool(ctx, 'run_existing_tests', { test_id: entry.id });
  assert.match(run, /exit code: 0/, run);
  assert.match(run, /usage limit reached/, 'the planted text really is in the suite output');
  const attempts = JSON.parse(await sh('cat /tmp/hostile-attempts.json'));
  assert.equal(attempts['overwrite /work/src/src/lib.js'], 'succeeded', 'precondition: the suite can still rewrite the prepared tree');
  assert.match(attempts['overwrite /src/src/lib.js'], /^refused/, 'the sealed mount is read-only');
  assert.match(attempts['write /work/bin/node'], /^refused/);
  assert.match(attempts['replace /work/bin directory'], /^refused/);
  assert.match(attempts['write /work/node-shim'], /^refused/);
  assert.equal(attempts['spawn setsid daemon'], 'started');
  assert.equal(attempts['write /out/lifecycle.json'], 'succeeded', 'precondition: /out is still writable, so only host-side placement protects the lifecycle');

  await t.test(`${invariant('R-01-bridge-node').id}: the bridge still runs the real node`, async () => {
    assert.equal(await exec("process.stdout.write(require('node:fs').readlinkSync('/proc/self/exe'))"), '/usr/local/bin/node');
    assert.equal(await sh('stat -c "%U:%G %a" /work /work/bin'), 'root:root 755\nroot:root 755');
    assert.ok(!(await sh('ls /work/bin')).split('\n').includes('node'), 'no planted node in /work/bin');
    // Every bridge call ran under the absolute path; a planted node would have left its marker.
    await callBridgeTool(ctx, 'list_files', {});
    assert.equal(await sh('test -e /tmp/hostile-node-ran && echo ran || echo absent'), 'absent', 'the planted node never ran');
  });

  await t.test(`${invariant('R-02-sealed-reads').id}: reviewers read the sealed content`, async () => {
    assert.match(await sh('cat /work/src/src/lib.js'), /TAMPERED/, 'the prepared /work/src was rewritten, so a read from it would be wrong');
    const read = await callBridgeTool(reviewer, 'read_file', { path: 'src/lib.js' });
    assert.match(read, new RegExp(expected.sealedContent));
    assert.doesNotMatch(read, /TAMPERED/);
    assert.match(await callBridgeTool(reviewer, 'read_file', { path: '/work/src/src/lib.js' }), new RegExp(expected.sealedContent), 'the name reviewers use still reads /src');
    assert.doesNotMatch(await callBridgeTool(reviewer, 'list_files', { path: 'src' }), /backdoor/);
    assert.match(await callBridgeTool(reviewer, 'search_code', { pattern: 'TAMPERED', path: 'src' }), /No matches found/);
  });

  await t.test(`${invariant('R-02-source-digest').id}: the digest of what was served equals the manifest`, () => {
    const served = readReportJson(report, 'harness/source-read-digest.json');
    assert.equal(served.digest, snapshot.manifest.digest);
    assert.equal(sourceReadDigestProblem(report), null);
    writeReportFile(report, 'harness/source-read-digest.json', JSON.stringify({ ...served, files: served.files.map(file => ({ ...file, sha256: '0'.repeat(64) })) }));
    assert.match(sourceReadDigestProblem(report), /does not match|differs/, 'a tampered record is caught by the report contract');
    writeReportFile(report, 'harness/source-read-digest.json', JSON.stringify(served));
  });

  await t.test(`${invariant('R-02-no-leftovers').id}: no uid-10001 process outlives the suite`, async () => {
    const pid = Number(await sh('cat /tmp/hostile-daemon.pid'));
    assert.ok(pid > 1, 'the daemon started');
    assert.equal(await sh(`test -d /proc/${pid} && echo alive || echo gone`), 'gone');
    const table = await sh("for d in /proc/[0-9]*; do p=${d#/proc/}; echo \"$p $(awk '/^PPid/{print $2}' $d/status 2>/dev/null) $(tr '\\0' ' ' < $d/cmdline 2>/dev/null)\"; done");
    const orphans = table.split('\n').filter(line => line.split(' ')[1] === '1');
    assert.ok(orphans.length >= 1 && orphans.every(line => /sandbox-inside\.mjs/.test(line)), `only the sandbox's own process is an orphan:\n${orphans.join('\n')}`);
    const row = readReportJson(report, 'harness/existing-test-results-verification.json').at(-1);
    assert.ok(row.killedProcesses.some(killed => killed.pid === pid), `killedProcesses lists the sleeper ${pid}: ${JSON.stringify(row.killedProcesses)}`);
    assert.equal(row.survivingProcesses, undefined);
    assert.equal(await sh('ls /work/runs | wc -l'), '0');
  });

  await t.test(`${invariant('R-04-host-lifecycle').id}: the host lifecycle is untouched by the forgery`, async () => {
    const forged = JSON.parse(fs.readFileSync(path.join(report, 'harness/sandbox-run/lifecycle.json'), 'utf8'));
    assert.equal(forged.state, 'lost', 'the container-side forgery exists');
    let lifecycle;
    for (let i = 0; i < 20 && !lifecycle; i++) {
      try { lifecycle = JSON.parse(fs.readFileSync(path.join(report, HOST_DIR, 'lifecycle.json'), 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.equal(lifecycle?.state, 'running');
    assert.equal(await sh('test -e /out/host && echo visible || echo hidden'), 'hidden');
    const mounts = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', container]).stdout);
    assert.ok(mounts.every(mount => !String(mount.Source).includes(`${path.sep}harness${path.sep}host`)), 'harness/host is not mounted');
    assert.ok(mounts.some(mount => mount.Destination === '/out' && String(mount.Source).endsWith(`${path.sep}sandbox-run`)));
    assert.equal(await Promise.race([session.lost, new Promise(resolve => setTimeout(() => resolve('still held'), 3500))]), 'still held', 'the orchestrator keeps the review running');
    assert.equal(docker(['inspect', '--format', '{{.State.Running}}', container]).stdout.trim(), 'true', 'a forged /out/sandbox.release does not stop the container');
  });

  await t.test(`${invariant('R-07-text-not-classified').id}: planted text never becomes a failure label`, () => {
    const forgedLog = fs.readFileSync(path.join(report, 'harness/sandbox-run/agent-claude-s1-auth.log'), 'utf8');
    assert.match(forgedLog, /usage limit reached/);
    assert.equal(classifyAuditFailure({ code: 1, stdout: forgedLog, stderr: run }).reason, 'process_error');
    assert.equal(classifyAuditFailure({ code: 1, rpcError: { code: -32000, message: 'usage limit reached' } }).reason, 'usage_limit');
    // The host reads its own log location, which the container cannot reach.
    assert.equal(hostLogRel('claude-s1-auth'), 'harness/host/agent-claude-s1-auth.log');
    assert.throws(() => readReportText(report, hostLogRel('claude-s1-auth')), /ENOENT/);
  });
});
