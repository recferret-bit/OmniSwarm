import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAuditFailure, classifyRpcError, FAILURE_MESSAGES } from './audit-process.mjs';

test('process failures have bounded labels without echoing provider output', () => {
  const secret = 'DO_NOT_ECHO_SAMPLE_PAYLOAD';
  for (const [input, expected] of [
    [{ code: 1, rpcError: { code: -32000, message: `You've hit your session limit ${secret}` } }, 'usage_limit'],
    [{ code: 1, rpcError: { code: -32603, message: "Internal error: You've hit your 5-hour limit · resets 7:10pm (Europe/Belgrade)" } }, 'usage_limit'],
    [{ code: 1, rpcError: { code: -32603, message: "You've hit your weekly limit" } }, 'usage_limit'],
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

test('only a provider limit message is a usage limit, whatever window it names', () => {
  const label = (message) => classifyRpcError({ code: -32603, message });
  for (const message of ["You've hit your 5-hour limit", "You've hit your weekly limit", "You've hit your Opus weekly limit · resets Mon", "Internal error: You've hit your session limit"]) assert.equal(label(message), 'usage_limit', message);
  for (const message of ["You've hit your stride", 'Internal error', "They've hit your limit on the target", "you've hit your a b c limit", 'rate of 5 per hour']) assert.equal(label(message), null, message);
});

test('the subprocess runner is gone: every reviewer runs through the ACP session client', async () => {
  const mod = await import('./audit-process.mjs');
  assert.equal(mod.runAgentProcess, undefined);
  assert.ok(FAILURE_MESSAGES.cost_ceiling && FAILURE_MESSAGES.live_required);
});
