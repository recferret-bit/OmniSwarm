import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { callBridgeTool, handleRpcMessage, toolDefinitions } from './docker-mcp-bridge.mjs';
import { bridgeRoleNames, loadBridgeRoles } from './bridge-tools-registry.mjs';

const snapshot = role => fs.readFileSync(new URL(`./bridge-tool-snapshots/${role}.json`, import.meta.url), 'utf8');

test('tools/list per role is byte-identical to the list main served before the split', () => {
  for (const role of ['auditor', 'crosscheck', 'verification']) {
    assert.equal(`${JSON.stringify(toolDefinitions(role), null, 2)}\n`, snapshot(role), role);
  }
  assert.equal(`${JSON.stringify(toolDefinitions(), null, 2)}\n`, snapshot('auditor'));
});

test('tools/list over JSON-RPC is assembled from bridge-tools-<role>.mjs', async () => {
  for (const role of ['auditor', 'crosscheck', 'verification']) {
    const response = await handleRpcMessage({ role }, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(`${JSON.stringify(response.result.tools, null, 2)}\n`, snapshot(role));
  }
  assert.deepEqual(bridgeRoleNames().sort(), ['auditor', 'crosscheck', 'debater', 'orchestrator', 'verification']);
});

test('an unknown role fails closed instead of falling back to auditor tools', async () => {
  assert.throws(() => toolDefinitions('debate'), /Unknown bridge role/);
  await assert.rejects(callBridgeTool({ role: '../etc' }, 'read_file', { path: 'x' }), /Unknown bridge role/);
});

test('a new bridge-tools-<role>.mjs adds a role without editing the dispatcher', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-role-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const common = pathToFileURL(path.resolve('scripts/bridge-tools-common.mjs')).href;
  fs.writeFileSync(path.join(dir, 'bridge-tools-dummy.mjs'), `
    import { commonToolDefinitions } from '${common}';
    export const role = 'dummy';
    export const toolDefinitions = () => [...commonToolDefinitions().slice(0, 1), { name: 'submit_audit_report', description: 'dummy', inputSchema: { type: 'object' } }];
    export const handlers = { get_audit_context: async () => 'dummy context', submit_audit_report: async ctx => 'dummy submit ' + ctx.role };
  `);
  fs.writeFileSync(path.join(dir, 'bridge-tools-bad.mjs'), 'export const role = "other";');
  await assert.rejects(loadBridgeRoles(dir), /declares role other/);
  fs.rmSync(path.join(dir, 'bridge-tools-bad.mjs'));
  await loadBridgeRoles(dir);
  assert.equal(toolDefinitions('dummy').length, 2);
  assert.equal(await callBridgeTool({ role: 'dummy' }, 'get_audit_context'), 'dummy context');
  // A role only exposes its own handlers.
  await assert.rejects(callBridgeTool({ role: 'dummy' }, 'read_file', { path: 'x' }), /unavailable in the dummy bridge role/);
});

test('beforeCall runs for every tool call before the handler and can refuse it', async () => {
  const seen = [];
  const ctx = { role: 'auditor', reportDir: '', beforeCall: async (c, name) => { seen.push(name); if (name === 'list_files') throw new Error('budget exhausted: call submit_audit_report now'); } };
  await assert.rejects(callBridgeTool(ctx, 'list_files', {}), /budget exhausted/);
  await assert.rejects(callBridgeTool(ctx, 'submit_crosscheck_report', {}), /unavailable in the auditor bridge role|Tool/);
  // A tool the role does not have is refused before the hook runs.
  assert.deepEqual(seen, ['list_files']);
});
