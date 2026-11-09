import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRecordedReader } from '../src/recorded-reader.mjs';
import { FrameDecoder, createGuardServer, encodeFrame, handleMessage, parseArgs } from '../mcp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH = 'GKot5hBsd81kMupNCXHaqbhv3huEbxAFMLnpcX2hniwn';
const NOW = Date.UTC(2026, 10, 9);
const REQUEST_HASH = 'a'.repeat(64);

const RECORDS = {
  accounts: { 'drained-vault.test.near': { code_hash: HASH, age_days: 400 } },
  attestations: {
    'drained-vault.test.near': {
      request_hash: REQUEST_HASH, repo: 'near/example', commit: 'c'.repeat(40),
      report_sha256: 'd'.repeat(64), report_uri: 'https://reports.example/drained-vault',
      deployed: 'drained-vault.test.near', code_hash: HASH, max_severity: 'critical',
      block_height: 120, binding_confirmed: true, block_timestamp_ms: NOW - 10 * 86_400_000,
    },
  },
  reported: [],
};

function server() {
  return createGuardServer({ reader: createRecordedReader(RECORDS), records: RECORDS, network: 'sandbox' });
}

test('the README demo and the example configs point at this server', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /claude mcp add omniswarm-guard -- node packages\/guard\/mcp\.mjs --api http:\/\/omniswarm\.localhost:18480/);
  const claude = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/mcp/claude-code.json'), 'utf8'));
  assert.deepEqual(claude.mcpServers['omniswarm-guard'].args[0], 'packages/guard/mcp.mjs');
  const codex = fs.readFileSync(path.join(ROOT, 'examples/mcp/codex.toml'), 'utf8');
  assert.match(codex, /packages\/guard\/mcp\.mjs/);
});

test('the server never imports a signer', () => {
  const source = fs.readFileSync(path.join(ROOT, 'mcp.mjs'), 'utf8');
  for (const line of source.split('\n')) {
    if (line.startsWith('import ')) assert.doesNotMatch(line, /signer|near-api-js|KeyPair|secretKey/i);
  }
  assert.doesNotMatch(source, /\bwrap\s*\(|signAndSend|InMemorySigner|KeyPair|secretKey/);
});

test('parseArgs refuses a key flag', () => {
  assert.throws(() => parseArgs(['--key', 'ed25519:abc']), /holds no key/);
  assert.throws(() => parseArgs([]), /pass --api/);
});

test('tools/list returns 3 tools and guard_verdict blocks drained-vault', async () => {
  const guard = server();
  const listed = await handleMessage(guard, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name).sort(), ['get_attestation', 'guard_verdict', 'is_reported']);
  const called = await handleMessage(guard, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'guard_verdict', arguments: { account: 'drained-vault.test.near', network: 'sandbox' } },
  });
  const body = JSON.parse(called.result.content[0].text);
  assert.equal(body.verdict, 'block');
  assert.ok(body.reasons.includes('ATTESTED_CRITICAL_STILL_DEPLOYED'));
  assert.equal(body.attestation.reportUri, 'https://reports.example/drained-vault');
  const reported = await guard.call('is_reported', { account: 'drained-vault.test.near' });
  assert.deepEqual(reported, { reported: false });
  const attestation = await guard.call('get_attestation', { request_hash: REQUEST_HASH });
  assert.equal(attestation.attestation.reportSha256, 'd'.repeat(64));
});

test('is_reported does not answer false when the API did not read the blocklist', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ verdict: 'warn', reasons: ['SIGNAL_UNAVAILABLE'], signals: { reported: null, unavailable: ['reported'] } }),
  });
  const guard = createGuardServer({ apiUrl: 'http://guard.test', fetchImpl });
  await assert.rejects(() => guard.call('is_reported', { account: 'phish.test.near' }), /is_reported unavailable/);
  const known = createGuardServer({
    apiUrl: 'http://guard.test',
    fetchImpl: async () => ({ ok: true, json: async () => ({ verdict: 'allow', reasons: ['NOT_A_CONTRACT'], signals: { reported: false } }) }),
  });
  assert.deepEqual(await known.call('is_reported', { account: 'alice.test.near' }), { reported: false });
});

test('stdio --recorded answers tools/list', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-mcp-'));
  const file = path.join(dir, 'recorded.json');
  fs.writeFileSync(file, JSON.stringify(RECORDS));
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp.mjs'), '--recorded', file], { stdio: ['pipe', 'pipe', 'pipe'] });
  const decoder = new FrameDecoder();
  /** @type {any[]} */
  const messages = [];
  child.stdout.on('data', (chunk) => { messages.push(...decoder.push(chunk)); });
  child.stdin.write(encodeFrame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }));
  child.stdin.write(encodeFrame({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  child.stdin.write(encodeFrame({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  const deadline = Date.now() + 5_000;
  while (messages.filter((message) => message.id === 2).length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  child.kill();
  const listed = messages.find((message) => message.id === 2);
  assert.ok(listed, 'tools/list did not answer');
  assert.deepEqual(listed.result.tools.map((tool) => tool.name).sort(), ['get_attestation', 'guard_verdict', 'is_reported']);
});
