import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { agyHookPreflight } from './agent-hook-preflight.mjs';
import { buildCliInvocation } from './agent-launch.mjs';

const policy = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audit-tool-policy.mjs');
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
function hooksFile(t, command = `${shellQuote(process.execPath)} ${shellQuote(policy)}`, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'hooks.json');
  fs.writeFileSync(file, JSON.stringify({ 'audit-docker': { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command }] }] }, ...extra }));
  return file;
}

test('R-08: the configured AGY hook refuses a host command and allows the review bridge', t => {
  assert.deepEqual(agyHookPreflight({ hooksFile: hooksFile(t) }), { state: 'ready' });
});

test('R-08: a hook that is removed, edited out or does not deny makes AGY unavailable with hook_not_enforced', t => {
  const unavailable = result => { assert.equal(result.state, 'unavailable'); assert.equal(result.reason, 'hook_not_enforced'); };
  unavailable(agyHookPreflight({ hooksFile: '/nonexistent/hooks.json' }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'empty.json'), JSON.stringify({ 'audit-docker': {} }));
  unavailable(agyHookPreflight({ hooksFile: path.join(dir, 'empty.json') }));
  fs.writeFileSync(path.join(dir, 'garbage.json'), '{');
  unavailable(agyHookPreflight({ hooksFile: path.join(dir, 'garbage.json') }));
  unavailable(agyHookPreflight({ hooksFile: hooksFile(t, 'true') }), 'a command that does nothing');
  unavailable(agyHookPreflight({ hooksFile: hooksFile(t, `${shellQuote(process.execPath)} -e ${shellQuote("process.stdout.write(JSON.stringify({decision:'allow'}))")} ${shellQuote(policy)}`) }));
  unavailable(agyHookPreflight({ hooksFile: hooksFile(t, `${shellQuote(process.execPath)} ${shellQuote(policy)}`, { Extra: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'true' }] }] } }) }));
});

test('R-08: AGY is not launched when the generated hook would not be enforced', t => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-launch-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const bin = path.join(work, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'agy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const invocation = buildCliInvocation({ agent: 'agy', model: 'm', prompt: 'p', workDir: path.join(work, 'ws'), bridgeArgs: ['--role', 'auditor'], env });
  assert.ok(invocation.args.includes('--dangerously-skip-permissions'));
  assert.deepEqual(agyHookPreflight({ hooksFile: path.join(work, 'ws', '.agents/plugins/audit-docker/hooks.json') }), { state: 'ready' });
  // Same launch with the policy script unusable: nodeBin that cannot run it.
  fs.mkdirSync(path.join(work, 'ws2'));
  assert.throws(() => buildCliInvocation({ agent: 'agy', model: 'm', prompt: 'p', workDir: path.join(work, 'ws2'), bridgeArgs: [], env, nodeBin: '/nonexistent/node' }), /AGY unavailable: hook_not_enforced/);
});
