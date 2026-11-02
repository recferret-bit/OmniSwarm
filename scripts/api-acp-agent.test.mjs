import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReviewSession } from './agent-session.mjs';
import { buildApiLaunch } from './provider-api-launch.mjs';
import { presetFor } from './provider-openai-compat.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'provider-fixtures', 'w03');
const STUB = `
import fs from 'node:fs';
fs.writeFileSync(process.argv[2], JSON.stringify(process.env));
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let at;
  while ((at = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id == null) continue;
    let result = {};
    if (msg.method === 'initialize') result = { protocolVersion: msg.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '0' } };
    else if (msg.method === 'tools/list') result = { tools: ['get_audit_context', 'read_file', 'list_existing_tests', 'run_existing_tests', 'submit_audit_report'].map((name) => ({ name, inputSchema: { type: 'object', properties: { findings: { type: 'array' }, report_json: { type: 'string' } } } })) };
    else if (msg.method === 'tools/call') result = { content: [{ type: 'text', text: 'stub ' + (msg.params?.name || '') }], isError: false };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
  }
});
`;

function harness(envExtra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'api-acp-'));
  fs.chmodSync(root, 0o700);
  const stub = path.join(root, 'stub.mjs');
  const envFile = path.join(root, 'bridge-env.json');
  fs.writeFileSync(stub, STUB);
  const directory = path.join(root, 'session');
  fs.mkdirSync(directory, { mode: 0o700 });
  const env = { HOME: '/home/inert', PATH: '/bin', USER: 'inert', ZAI_API_KEY: 'zk-test', OPENROUTER_API_KEY: 'or-test', ...envExtra };
  const launch = (opts) => buildApiLaunch(
    { provider: 'zai', model: opts.model },
    { workDir: opts.workDir, env: opts.env, bridgeArgs: [envFile], mcpCommand: process.execPath, mcpLeadingArgs: [stub] },
    presetFor('zai'),
  );
  return { root, envFile, directory, env, launch };
}

test('runReviewSession drives the api ACP agent through a stub bridge', async () => {
  const h = harness({ OMNI_HTTP_REPLAY: FIXTURE });
  const logFile = path.join(h.root, 'agent.log');
  const result = await runReviewSession({
    directory: h.directory,
    identity: { agent: 'key-zai-glm-5-3', family: 'key', provider: 'zai', model: 'glm-5.3', role: 'auditor', sourceDigest: 'a'.repeat(64), assignmentDigest: 'b'.repeat(64) },
    bridgeArgs: [h.envFile],
    prompt: 'Review the fixture.',
    env: h.env,
    logFile,
  }, { launch: h.launch, heartbeatMs: 60_000 });
  assert.equal(result.code, 0, result.failureReason);
  assert.equal(result.transport, 'api-acp');
  assert.equal(result.stopReason, 'end_turn');
  const state = JSON.parse(fs.readFileSync(path.join(h.directory, 'state.json'), 'utf8'));
  assert.equal(state.transport, 'api-acp');
  const log = fs.readFileSync(logFile, 'utf8');
  assert.equal(log.split('"sessionUpdate":"tool_call"').length - 1, 2);
  const bridgeEnv = JSON.parse(fs.readFileSync(h.envFile, 'utf8'));
  assert.equal(bridgeEnv.ZAI_API_KEY, undefined);
  assert.equal(bridgeEnv.OPENROUTER_API_KEY, undefined);
  assert.equal(fs.readFileSync(path.join(h.directory, 'workspace', 'api-launch.json'), 'utf8').includes('zk-test'), false);
});

test('a mismatched served model fails the session as model_mismatch', async () => {
  const replay = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
  fs.mkdirSync(path.join(replay, 'zai'), { recursive: true });
  fs.writeFileSync(path.join(replay, 'zai', '0.json'), JSON.stringify({ status: 200, body: { model: 'glm-5.1', choices: [{ message: { content: 'wrong model' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }));
  const h = harness({ OMNI_HTTP_REPLAY: replay });
  const result = await runReviewSession({
    directory: h.directory,
    identity: { agent: 'key-zai-glm-5-3', family: 'key', provider: 'zai', model: 'glm-5.3', role: 'auditor', sourceDigest: 'c'.repeat(64), assignmentDigest: 'd'.repeat(64) },
    bridgeArgs: [h.envFile],
    prompt: 'Review.',
    env: h.env,
    logFile: path.join(h.root, 'mismatch.log'),
  }, { launch: h.launch, heartbeatMs: 60_000 });
  assert.equal(result.code, 1);
  assert.equal(result.failureReason, 'model_mismatch');
});
