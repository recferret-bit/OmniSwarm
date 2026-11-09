// @ts-check
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeServer, handleRequest, parseArgs, resolveOptions, startServer } from './indexer.mjs';

const ORIGIN = 'http://omniswarm.localhost:18480';
const HASH = '6zgh2u9DqHHiXzdy9ouTP7oGky2T4nugqzqt9wJZwNFm';
const CODE_HASH = '8iTgRHpmMG2DzuPFDyBXTSkdxJMKmdNfmYo1sJUFKVNS';
const INDEXER = fileURLToPath(new URL('./indexer.mjs', import.meta.url));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omniswarm-indexer-'));
}

/**
 * @param {unknown} body
 * @param {number} [status]
 */
function jsonRpc(body, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function txResult() {
  const event = {
    standard: 'omniswarm',
    version: '1.2.0',
    event: 'review_attested',
    data: [{ request_hash: 'ab', repo: 'acme/widgets', max_severity: 'low' }],
  };
  return {
    jsonrpc: '2.0',
    id: 'omniswarm-indexer',
    result: {
      final_execution_status: 'FINAL',
      status: { SuccessValue: '' },
      transaction: { signer_id: 'operator.test.near', receiver_id: 'registry.test.near', hash: HASH },
      transaction_outcome: {
        id: HASH,
        outcome: { logs: [], status: { SuccessReceiptId: 'r1' }, receipt_ids: ['r1'], executor_id: 'operator.test.near' },
      },
      receipts_outcome: [{
        id: 'r1',
        outcome: {
          executor_id: 'registry.test.near',
          logs: [`EVENT_JSON:${JSON.stringify(event)}`, '</pre><script>alert(1)</script>'],
          receipt_ids: [],
          status: { SuccessValue: '' },
          gas_burnt: 1,
          tokens_burnt: '0',
        },
      }],
      receipts: [{ predecessor_id: 'operator.test.near', receiver_id: 'registry.test.near', receipt_id: 'r1' }],
    },
  };
}

/**
 * @param {string} method
 */
function methodNotFound(method) {
  return jsonRpc({
    jsonrpc: '2.0',
    id: 'omniswarm-indexer',
    error: {
      name: 'REQUEST_VALIDATION_ERROR',
      cause: { name: 'METHOD_NOT_FOUND', info: { method_name: method } },
      code: -32601,
      message: 'Method not found',
      data: method,
    },
  });
}

/**
 * @param {string} hash
 */
function unknownTx(hash) {
  return jsonRpc({
    jsonrpc: '2.0',
    id: 'omniswarm-indexer',
    error: {
      name: 'HANDLER_ERROR',
      cause: { name: 'UNKNOWN_TRANSACTION', info: { requested_transaction_hash: hash } },
      code: -32000,
      message: 'Server error',
      data: `Transaction ${hash} doesn't exist`,
    },
  });
}

/**
 * @param {Parameters<typeof resolveOptions>[0]} options
 * @param {(port: number) => Promise<void>} fn
 */
async function withServer(options, fn) {
  const server = await startServer({ port: 0, ...options });
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    assert.equal(address.address, '127.0.0.1');
    await fn(address.port);
  } finally {
    await closeServer(server);
  }
}

/**
 * @param {Awaited<ReturnType<typeof resolveOptions>>} ctx
 * @param {{ method?: string, url: string, remoteAddress?: string }} req
 */
async function call(ctx, req) {
  let status = 0;
  /** @type {Record<string, string | number | string[] | undefined>} */
  let responseHeaders = {};
  let body = '';
  const res = {
    headersSent: false,
    /**
     * @param {number} code
     * @param {Record<string, string | number | string[] | undefined>} hdrs
     */
    writeHead(code, hdrs) {
      status = code;
      responseHeaders = hdrs;
      this.headersSent = true;
    },
    /** @param {string} [chunk] */
    end(chunk) {
      if (chunk) body += chunk;
    },
  };
  const incoming = { method: req.method ?? 'GET', url: req.url, headers: {}, socket: { remoteAddress: req.remoteAddress ?? '127.0.0.1' } };
  await handleRequest(/** @type {any} */ (incoming), /** @type {any} */ (res), ctx);
  return { status, headers: responseHeaders, body };
}

test('parseArgs refuses the sandbox RPC port and reads the created-file argument', () => {
  assert.throws(() => parseArgs(['--port', '3030']), /3030/);
  assert.deepEqual(parseArgs(['--port', '0', '--created', '/tmp/created.json']), { port: 0, createdFile: '/tmp/created.json' });
});

test('CREATED_ACCOUNTS_FILE overrides the default creation file', () => {
  const previous = process.env.CREATED_ACCOUNTS_FILE;
  process.env.CREATED_ACCOUNTS_FILE = '/tmp/omniswarm-created.json';
  try {
    assert.equal(resolveOptions({ port: 0 }).createdFile, '/tmp/omniswarm-created.json');
  } finally {
    if (previous === undefined) delete process.env.CREATED_ACCOUNTS_FILE;
    else process.env.CREATED_ACCOUNTS_FILE = previous;
  }
});

test('GET /v1/account returns the NearBlocks shape, and an unknown account is an empty list', async () => {
  const dir = tempDir();
  const createdFile = path.join(dir, 'created.json');
  fs.writeFileSync(createdFile, `${JSON.stringify({
    'alice.test.near': { blockTimestampNs: '1690000000000000000', blockHeight: 7 },
    'bob.test.near': { blockTimestampNs: 1700000000000, blockHeight: 8 },
  })}\n`);
  try {
    await withServer({ createdFile, keysDir: dir, fetch: async () => { throw new Error('account age does not call RPC'); } }, async (port) => {
      const alice = await fetch(`http://127.0.0.1:${port}/v1/account/alice.test.near`);
      assert.equal(alice.status, 200);
      assert.equal(alice.headers.get('access-control-allow-origin'), ORIGIN);
      assert.match(alice.headers.get('content-type') ?? '', /^application\/json/);
      assert.deepEqual(await alice.json(), { account: [{ created: { block_timestamp: '1690000000000000000' } }] });

      const bob = await fetch(`http://127.0.0.1:${port}/v1/account/bob.test.near`);
      assert.deepEqual(await bob.json(), { account: [{ created: { block_timestamp: 1700000000000 } }] });
      assert.equal(bob.headers.get('access-control-allow-origin'), ORIGIN);

      const missing = await fetch(`http://127.0.0.1:${port}/v1/account/carol.test.near`);
      assert.equal(missing.status, 200);
      assert.deepEqual(await missing.json(), { account: [] });
      assert.equal(missing.headers.get('access-control-allow-origin'), ORIGIN);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a JSON number that cannot hold nanoseconds is refused', async () => {
  const dir = tempDir();
  const createdFile = path.join(dir, 'created.json');
  fs.writeFileSync(createdFile, '{"alice.test.near":{"blockTimestampNs":1690000000000000000,"blockHeight":1}}\n');
  try {
    await withServer({ createdFile, keysDir: dir }, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/account/alice.test.near`);
      assert.equal(res.status, 500);
      assert.match(await res.text(), /blockTimestampNs/);
      assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the tx page shows review_attested from a stubbed sandbox RPC', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'created.json'), '{}\n');
  /** @type {Array<{ url: string, payload: any }>} */
  const calls = [];
  const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url: String(url), payload: JSON.parse(init.body) });
    return jsonRpc(txResult());
  };
  try {
    await withServer({ createdFile: path.join(dir, 'created.json'), keysDir: dir, fetch: fetchImpl }, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/txns/${HASH}?sender=operator.test.near`);
      const html = await res.text();
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
      assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
      assert.match(html, /review_attested/);
      assert.match(html, /Status: FINAL/);
      assert.equal(html.includes('<script>'), false);
      assert.match(html, /&lt;script&gt;/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://127.0.0.1:3030');
      assert.equal(calls[0].payload.method, 'tx_status');
      assert.equal(calls[0].payload.params.tx_hash, HASH);
      assert.equal(calls[0].payload.params.sender_account_id, 'operator.test.near');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tx status falls back from tx_status to EXPERIMENTAL_tx_status', async () => {
  const dir = tempDir();
  /** @type {string[]} */
  const methods = [];
  const fetchImpl = async (_url, /** @type {any} */ init) => {
    const payload = JSON.parse(init.body);
    methods.push(payload.method);
    if (payload.method === 'tx_status') return methodNotFound('tx_status');
    return jsonRpc(txResult());
  };
  try {
    await withServer({ createdFile: path.join(dir, 'missing-created.json'), keysDir: dir, fetch: fetchImpl }, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/txns/${HASH}?sender=operator.test.near`);
      assert.match(await res.text(), /review_attested/);
      assert.deepEqual(methods, ['tx_status', 'EXPERIMENTAL_tx_status']);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a tx URL without a sender skips accounts that do not have the transaction', async () => {
  const dir = tempDir();
  const keysDir = path.join(dir, 'keys');
  fs.mkdirSync(keysDir);
  fs.writeFileSync(path.join(dir, 'created.json'), '{}\n');
  /** @type {string[]} */
  const senders = [];
  const fetchImpl = async (_url, /** @type {any} */ init) => {
    const payload = JSON.parse(init.body);
    senders.push(payload.params.sender_account_id);
    if (payload.params.sender_account_id === 'test.near') return unknownTx(HASH);
    return jsonRpc(txResult());
  };
  try {
    await withServer({ createdFile: path.join(dir, 'created.json'), keysDir, fetch: fetchImpl }, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/txns/${HASH}`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /review_attested/);
      assert.deepEqual(senders, ['test.near', 'registry.test.near']);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreachable sandbox is a 502 page', async () => {
  const dir = tempDir();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('connect ECONNREFUSED 127.0.0.1:3030');
  };
  try {
    await withServer({ createdFile: path.join(dir, 'none.json'), keysDir: dir, fetch: fetchImpl }, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/txns/${HASH}?sender=operator.test.near`);
      assert.equal(res.status, 502);
      assert.match(await res.text(), /The sandbox is unreachable\./);
      assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
      assert.equal(calls, 1);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the address page shows the code hash and the attestation', async () => {
  const dir = tempDir();
  /** @type {any[]} */
  const payloads = [];
  const attestation = {
    request_hash: 'aa',
    repo: 'acme/widgets',
    max_severity: 'critical',
    code_hash: CODE_HASH,
    binding_confirmed: true,
  };
  const fetchImpl = async (_url, /** @type {any} */ init) => {
    const payload = JSON.parse(init.body);
    payloads.push(payload);
    if (payload.params.request_type === 'view_account') {
      return jsonRpc({
        jsonrpc: '2.0',
        result: { amount: '1', locked: '0', code_hash: CODE_HASH, storage_usage: 100, storage_paid_at: 0, block_height: 4, block_hash: 'HH' },
      });
    }
    const bytes = [...Buffer.from(JSON.stringify(attestation))];
    return jsonRpc({ jsonrpc: '2.0', result: { result: bytes, logs: [], block_height: 4, block_hash: 'HH' } });
  };
  try {
    await withServer({ createdFile: path.join(dir, 'none.json'), keysDir: dir, fetch: fetchImpl }, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/address/good-dex.test.near`);
      const html = await res.text();
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
      assert.match(html, new RegExp(`Code hash: ${CODE_HASH}`));
      assert.match(html, /Attestation: critical/);
      assert.equal(payloads.length, 2);
      assert.equal(payloads[0].method, 'query');
      assert.equal(payloads[0].params.request_type, 'view_account');
      assert.equal(payloads[0].params.account_id, 'good-dex.test.near');
      assert.equal(payloads[1].params.request_type, 'call_function');
      assert.equal(payloads[1].params.method_name, 'get_attestation_for_account');
      assert.equal(payloads[1].params.account_id, 'registry.test.near');
      assert.deepEqual(JSON.parse(Buffer.from(payloads[1].params.args_base64, 'base64').toString('utf8')), { account: 'good-dex.test.near' });
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/wallet/accounts returns dev keys to loopback and 403s otherwise', async () => {
  const dir = tempDir();
  const secret = 'ed25519:dev-only-not-a-real-key';
  fs.writeFileSync(path.join(dir, 'alice.json'), `${JSON.stringify({
    account_id: 'alice.test.near',
    public_key: 'ed25519:pub',
    private_key: secret,
  })}\n`);
  fs.writeFileSync(path.join(dir, 'operator.json'), `${JSON.stringify({
    account_id: 'operator.test.near',
    public_key: 'ed25519:op',
    secret_key: 'ed25519:operator-secret',
  })}\n`);
  const createdFile = path.join(dir, 'created.json');
  let fetched = false;
  const ctx = resolveOptions({
    port: 0,
    createdFile,
    keysDir: dir,
    fetch: async () => { fetched = true; throw new Error('wallet must not call RPC'); },
  });
  try {
    await withServer({ createdFile, keysDir: dir, fetch: ctx.fetch }, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/wallet/accounts`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
      assert.deepEqual(await res.json(), {
        accounts: [
          { account_id: 'alice.test.near', public_key: 'ed25519:pub', private_key: secret },
          { account_id: 'operator.test.near', public_key: 'ed25519:op', private_key: 'ed25519:operator-secret' },
        ],
      });
    });

    const denied = await call(ctx, { url: '/wallet/accounts', remoteAddress: '8.8.8.8' });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(denied.body.includes(secret), false);
    assert.equal(fetched, false);

    const accountDenied = await call(ctx, { url: '/v1/account/alice.test.near', remoteAddress: '10.1.2.3' });
    assert.equal(accountDenied.status, 403);
    assert.equal(accountDenied.headers['access-control-allow-origin'], ORIGIN);

    const allowed = await call(ctx, { url: '/v1/account/carol.test.near', remoteAddress: '::1' });
    assert.equal(allowed.status, 200);
    assert.deepEqual(JSON.parse(allowed.body), { account: [] });

    const mapped = await call(ctx, { url: '/wallet/accounts', remoteAddress: '::ffff:127.0.0.1' });
    assert.equal(mapped.status, 403);
    assert.equal(mapped.body.includes(secret), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SIGINT closes the listener', async () => {
  const dir = tempDir();
  const created = path.join(dir, 'created.json');
  fs.writeFileSync(created, '{}\n');
  const child = spawn(process.execPath, [INDEXER, '--port', '0', '--created', created, '--keys', dir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`indexer did not listen\n${stdout}\n${stderr}`)), 5000);
      child.stdout.on('data', () => {
        const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
        if (!match) return;
        clearTimeout(timer);
        resolve(Number(match[1]));
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`indexer exited ${code} before listen\n${stdout}\n${stderr}`));
      });
    });
    const res = await fetch(`http://127.0.0.1:${port}/v1/account/missing.test.near`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { account: [] });
    child.kill('SIGINT');
    const code = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(code, 0);
    const closed = await new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => resolve(true));
    });
    assert.equal(closed, true);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
