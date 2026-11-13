// The access-key verifier behind NEAR wallet sign-in, against a local JSON-RPC server that answers with
// recorded bodies (test/fixtures/near-rpc.json). No live RPC.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, test } from 'node:test';
import { RpcAccountKeyVerifier } from '../../src/near/key-verifier.ts';
import { MockAccountKeyVerifier } from '../../src/near/mock-key-verifier.ts';
import { AppError } from '../../src/shared/errors.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';

const REC = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'test/fixtures/near-rpc.json'), 'utf8'));
const KEY = 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp';
type Call = { method: string; params: any };
type Answer = { result?: unknown; error?: unknown; status?: number };

const servers: http.Server[] = [];
after(() => { for (const server of servers) server.close(); });

async function rpc(answer: (call: Call) => Answer) {
  const calls: Call[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const request = JSON.parse(body);
      calls.push({ method: request.method, params: request.params });
      const reply = answer(request);
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
      res.end(reply.status && reply.status !== 200 ? 'rate limited' : JSON.stringify({ jsonrpc: '2.0', id: request.id, ...reply }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls };
}

function keys(call: Call): Answer {
  if (call.method === 'query' && call.params.request_type === 'view_access_key') {
    if (call.params.account_id === 'nobody.near') return { error: REC.unknown_key };
    return { result: call.params.account_id === 'limited.near' ? REC.key_function_call : REC.key_full };
  }
  return { error: { code: -32601, message: 'method not found' } };
}

test('full access, function call and unknown keys, read at final finality', async () => {
  const server = await rpc(keys);
  const verifier = new RpcAccountKeyVerifier([server.url]);
  assert.equal(await verifier.keyPermission('alice.near', KEY), 'FullAccess');
  assert.equal(await verifier.keyPermission('limited.near', KEY), 'FunctionCall');
  assert.equal(await verifier.keyPermission('nobody.near', KEY), null);
  assert.equal(server.calls[0]?.params.finality, 'final');
  assert.deepEqual(server.calls.map((call) => call.params.request_type), ['view_access_key', 'view_access_key', 'view_access_key']);
});

test('failover: a rate-limited provider falls through to the next; all down fails closed with a retryable 503', async () => {
  const down = await rpc(() => ({ status: 429 }));
  const up = await rpc(keys);
  assert.equal(await new RpcAccountKeyVerifier([down.url, up.url]).keyPermission('alice.near', KEY), 'FullAccess');
  await assert.rejects(new RpcAccountKeyVerifier([down.url]).keyPermission('alice.near', KEY), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 503);
    assert.equal(error.retryable, true);
    return true;
  });
});

test('the mock treats unknown keys as full access unless a test pins them', async () => {
  const mock = new MockAccountKeyVerifier();
  assert.equal(await mock.keyPermission('a.near', KEY), 'FullAccess');
  mock.register('a.near', KEY, 'FunctionCall');
  assert.equal(await mock.keyPermission('a.near', KEY), 'FunctionCall');
  mock.register('b.near', KEY, null);
  assert.equal(await mock.keyPermission('b.near', KEY), null);
});
