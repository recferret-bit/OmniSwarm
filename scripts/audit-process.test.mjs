import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyAuditFailure, classifyRpcError, runAgentProcess } from './audit-process.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-process-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, log: path.join(dir, 'process.log') };
}
const invocation = (cwd, script) => ({ executable: process.execPath, args: ['-e', script], cwd, stdin: '' });

test('audit process preserves provider refusal and real exit code', async (t) => {
  const f = fixture(t);
  const result = await runAgentProcess(invocation(f.dir, 'console.error("This content was flagged for possible cybersecurity risk."); process.exit(1)'), null, f.log);
  assert.equal(result.code, 1);
  assert.equal(result.timedOut, false);
  // R-07: the text reached the log, but only a structured RPC error can label the failure.
  assert.equal(classifyAuditFailure(result).reason, 'process_error');
  assert.match(fs.readFileSync(f.log, 'utf8'), /cybersecurity risk/);
  assert.equal(fs.statSync(f.log).mode & 0o777, 0o600);
});

test('deadline kills a hung worker and records timeout', async (t) => {
  const f = fixture(t);
  const result = await runAgentProcess(invocation(f.dir, 'setInterval(() => {}, 1000)'), 100, f.log);
  assert.equal(result.code, 124);
  assert.equal(result.timedOut, true);
  assert.equal(classifyAuditFailure(result).reason, 'timeout');
});

test('cancellation stops the worker without misreporting a timeout', async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  const run = runAgentProcess(invocation(f.dir, 'setInterval(() => {}, 1000)'), 5000, f.log, { signal: controller.signal });
  controller.abort();
  const result = await run;
  assert.notEqual(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, 'SIGKILL');
});

test('process failures have bounded labels without echoing provider output', () => {
  const secret = 'DO_NOT_ECHO_SAMPLE_PAYLOAD';
  for (const [input, expected] of [
    [{ code: 1, rpcError: { code: -32000, message: `You've hit your session limit ${secret}` } }, 'usage_limit'],
    [{ code: 1, rpcError: JSON.stringify({ code: -32000, message: `Authentication required ${secret}` }) }, 'auth_required'],
    [{ code: 0, rpcError: { code: -32000, message: `The project MCP server never attached ${secret}` } }, 'mcp_unavailable'],
    [{ code: 1, rpcError: { code: 8, message: 'quota', data: { reason: 'RESOURCE_EXHAUSTED' } } }, 'usage_limit'],
    [{ code: 124 }, 'timeout'],
    [{ code: 1 }, 'process_error'],
    [{}, 'missing_exit'],
    [{ code: 0 }, 'missing_report'],
  ]) {
    const failure = classifyAuditFailure(input);
    assert.equal(failure.reason, expected);
    assert.ok(!failure.message.includes(secret));
  }
});

test('R-07: text quoted from target source in stdout, stderr or a non-error value is never classified', () => {
  const quoted = "// usage limit reached; You've hit your session limit; RESOURCE_EXHAUSTED; flagged for possible cybersecurity risk; authentication required";
  assert.equal(classifyAuditFailure({ code: 1, stdout: quoted, stderr: quoted }).reason, 'process_error');
  assert.equal(classifyAuditFailure({ code: 0, stdout: quoted }).reason, 'missing_report');
  assert.equal(classifyAuditFailure({ code: 0, stdout: quoted }, 'unknown').reason, 'unknown');
  for (const notAFrame of [quoted, 42, null, [quoted], JSON.stringify(quoted), '{', JSON.stringify([{ message: quoted }])]) assert.equal(classifyRpcError(notAFrame), null);
  assert.equal(classifyRpcError({ code: -32000, message: 'usage limit reached' }), 'usage_limit');
});

test('invalid deadlines and log symlinks fail before launching a process', async (t) => {
  const f = fixture(t);
  for (const timeout of [NaN, Infinity, 0, -1, 2 ** 32]) assert.throws(() => runAgentProcess(invocation(f.dir, ''), timeout, f.log));
  const target = path.join(f.dir, 'target');
  fs.writeFileSync(target, 'unchanged');
  fs.symlinkSync(target, f.log);
  await assert.rejects(runAgentProcess(invocation(f.dir, 'process.exit(0)'), 5000, f.log));
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
  const hardlink = path.join(f.dir, 'hardlink');
  fs.linkSync(target, hardlink);
  await assert.rejects(runAgentProcess(invocation(f.dir, 'process.exit(0)'), 5000, hardlink));
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
});

// A silent reviewer must remain alive across repeated heartbeat intervals.
test('unlimited silent review emits heartbeats until explicitly cancelled', async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  const beats = [];
  const result = await runAgentProcess(invocation(f.dir, 'setInterval(() => {}, 1000)'), null, f.log, {
    signal: controller.signal, heartbeatMs: 30,
    onProgress: (beat) => { beats.push(beat); if (beats.length === 4) controller.abort(); },
  });
  assert.ok(beats.length >= 4);
  assert.ok(beats[3].elapsedMs >= 100);
  assert.ok(beats[3].idleMs >= 100);
  assert.ok(beats.every((beat) => Number.isInteger(beat.pid)));
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, 'SIGKILL');
});

test('unlimited review completes successfully after repeated heartbeats', async (t) => {
  const f = fixture(t);
  let beats = 0;
  const result = await runAgentProcess(invocation(f.dir, 'setTimeout(() => console.log("submitted"), 150)'), undefined, f.log, {
    heartbeatMs: 30, onProgress: () => { beats++; },
  });
  assert.ok(beats >= 3);
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /submitted/);
});
