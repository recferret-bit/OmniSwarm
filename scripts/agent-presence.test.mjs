import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agyHookStatus, checkBridgeAgents, presenceProviders } from './agent-presence.mjs';

test('the presence list comes from the cli family and leaves out claude-zai', () => {
  assert.deepEqual(presenceProviders().sort(), ['agy', 'claude', 'codex', 'grok']);
});

test('R-08: check-agents stages the AGY plugin exactly as a review does and runs the hook both ways', () => {
  assert.deepEqual(agyHookStatus(), { state: 'ready' });
  const broken = agyHookStatus({ preflight: () => { throw new Error('hook missing'); } });
  assert.equal(broken.state, 'unavailable');
  assert.equal(broken.reason, 'hook_not_enforced');
});

test('an AGY whose hook does not refuse host tools is reported unavailable, not ready', (t) => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-bin-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bin, 'agy'), '#!/bin/sh\necho agy 9.9.9\n', { mode: 0o755 });
  const env = { PATH: bin, HOME: os.tmpdir() };
  const rows = (hookStatus) => checkBridgeAgents(env, { hookStatus }).agents;
  const enforced = rows(() => ({ state: 'ready' })).find((row) => row.agent === 'agy');
  assert.equal(enforced.state, 'ready');
  assert.equal(enforced.hook, 'enforced');
  const open = rows(() => ({ state: 'unavailable', reason: 'hook_not_enforced', detail: 'the hook did not refuse a host command tool' })).find((row) => row.agent === 'agy');
  assert.equal(open.state, 'unavailable');
  assert.equal(open.hook, 'hook_not_enforced');
  assert.equal(rows(() => ({ state: 'ready' })).find((row) => row.agent === 'claude').state, 'unavailable', 'no claude on this PATH');
});
