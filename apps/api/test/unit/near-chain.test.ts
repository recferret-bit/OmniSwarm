// NearChainAdapter against local JSON-RPC servers that answer with recorded bodies
// (test/fixtures/near-rpc.json). No live RPC. Checks the finality the adapter asks for, the payment
// tx rules, failover, not-found mapping, operator writes and the registry v0.2 refund bool.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { KeyPair } from 'near-api-js';
import { ChainRejectedError } from '../../src/chain/errors.ts';
import { NearChainAdapter } from '../../src/chain/near/near-chain.ts';
import { loadOperatorKey } from '../../src/chain/near/operator-key.ts';
import { panicReason, returnValue } from '../../src/chain/near/payment-tx.ts';
import { chainReader, guardPort } from '../../src/modules/guard/guard.port.ts';
import { AppError } from '../../src/shared/errors.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';

const REC = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'test/fixtures/near-rpc.json'), 'utf8'));
const H: string = REC.requestHash;

type Call = { method: string; params: any };
type Answer = { result?: unknown; error?: unknown; status?: number };

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
const servers: http.Server[] = [];
after(() => { for (const server of servers) server.close(); });

function registry(call: Call): Answer {
  const p = call.params;
  if (call.method === 'tx') return p.tx_hash === 'unknown' ? { error: REC.unknown_tx } : { result: REC.tx_paid };
  if (call.method === 'block') return { result: REC.block };
  if (call.method === 'query' && p.request_type === 'call_function') {
    if (p.method_name === 'is_reported') {
      const args = JSON.parse(Buffer.from(p.args_base64, 'base64').toString('utf8'));
      return { result: args.account_id === 'drainer.testnet' ? REC.is_reported_true : REC.is_reported_false };
    }
    const name = { get_request: 'get_request', get_attestation: 'get_attestation', get_attestation_for_account: 'get_attestation', get_price: 'get_price' }[p.method_name as string];
    return { result: REC[name ?? 'null_view'] };
  }
  if (call.method === 'query' && p.request_type === 'view_access_key') {
    if (p.account_id === 'nobody.testnet') return { error: REC.unknown_key };
    return { result: p.account_id === 'limited.testnet' ? REC.key_function_call : REC.key_full };
  }
  if (call.method === 'query' && p.request_type === 'view_account') return { result: p.account_id === 'plain.testnet' ? REC.account_plain : REC.account_contract };
  return { error: { name: 'REQUEST_VALIDATION_ERROR', cause: { name: 'METHOD_NOT_FOUND', info: { method_name: call.method } }, code: -32601, message: 'Method not found' } };
}

function adapter(urls: string[], operator: (() => ReturnType<typeof loadOperatorKey>) | null = null) {
  return new NearChainAdapter({ rpcUrls: urls, contractId: 'registry.testnet', operatorAccountId: null, operator });
}

test('reads: tx with wait_until FINAL, views with finality final, key permission and accounts', async () => {
  const server = await rpc(registry);
  const chain = adapter([server.url]);
  const tx = await chain.getPaymentTx('7AfonAhbK4ZbdBU9VPcQdrTZVZBXE25HmZAMEABs9To1', 'alice.testnet');
  assert.deepEqual(tx, { txHash: '7AfonAhbK4ZbdBU9VPcQdrTZVZBXE25HmZAMEABs9To1', succeeded: true, signerId: 'alice.testnet', receiverId: 'registry.testnet', requestHash: H, depositYocto: 10n ** 24n });
  assert.equal(server.calls[0]?.params.wait_until, 'FINAL');
  assert.equal(await chain.getPaymentTx('unknown', 'alice.testnet'), null);
  assert.deepEqual(await chain.getRequest(H), { account: 'alice.testnet', depositYocto: 10n ** 24n, blockHeight: 219999990, status: 'Pending' });
  const attestation = await chain.getAttestationForAccount('dex.testnet');
  assert.equal(attestation?.bindingConfirmed, true);
  assert.equal(attestation?.blockTimestampMs, 1793700000000);
  assert.equal(await chain.getPrice(), 10n ** 24n);
  assert.equal(await chain.keyPermission('alice.testnet', 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp'), 'FullAccess');
  assert.equal(await chain.keyPermission('limited.testnet', 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp'), 'FunctionCall');
  assert.equal(await chain.keyPermission('nobody.testnet', 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp'), null);
  assert.deepEqual(await chain.viewAccount('plain.testnet'), { codeHash: '11111111111111111111111111111111' });
  assert.equal(await chain.blockTimestampMs(220000100), 1793700000000);
  for (const call of server.calls.filter((c) => c.method === 'query')) assert.equal(call.params.finality, 'final', JSON.stringify(call.params));
  assert.deepEqual(await chain.health(), { rpc: true, contract: true });
});

test('a bounced refund is SuccessValue false, not a panic, even when the transfer receipt failed', () => {
  const raw = {
    final_execution_status: 'FINAL',
    status: { SuccessValue: Buffer.from('false').toString('base64') },
    receipts_outcome: [{ outcome: { status: { Failure: { ActionError: { kind: 'AccountDoesNotExist' } } }, logs: [] } }],
  };
  assert.equal(panicReason(raw), null);
  assert.equal(returnValue(raw), false);
  assert.equal(panicReason(REC.attest_bad_status), 'ERR_BAD_STATUS');
});

test('payment tx rules: a failed receipt or extra args never bind a request', async () => {
  const failed = await rpc(() => ({ result: REC.tx_failed }));
  assert.equal((await adapter([failed.url]).getPaymentTx('x', 'alice.testnet'))?.succeeded, false);
  const extra = await rpc(() => ({ result: REC.tx_two_args }));
  assert.equal((await adapter([extra.url]).getPaymentTx('x', 'alice.testnet'))?.requestHash, null);
});

test('failover: a rate-limited provider falls through to the next; all down is CHAIN_UNAVAILABLE', async () => {
  const limited = await rpc(() => ({ status: 503 }));
  const healthy = await rpc(registry);
  assert.equal((await adapter([limited.url, healthy.url]).getRequest(H))?.status, 'Pending');
  assert.ok(limited.calls.length >= 1 && healthy.calls.length === 1);
  const down = await rpc(() => ({ status: 503 }));
  await assert.rejects(adapter([down.url]).getRequest(H), (error: unknown) => error instanceof AppError && error.code === 'CHAIN_UNAVAILABLE');
});

test('operator writes sign with the key file, wait for FINAL and read the refund bool', async () => {
  const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'key-')), 'operator.key');
  fs.writeFileSync(keyFile, JSON.stringify({ account_id: 'operator.testnet', private_key: KeyPair.fromRandom('ed25519').toString() }), { mode: 0o600 });
  let sendResult = REC.refund_true;
  const server = await rpc((call) => (call.method === 'send_tx' ? { result: sendResult } : registry(call)));
  const chain = adapter([server.url], () => loadOperatorKey(keyFile));
  await assert.rejects(adapter([server.url]).refund(H), /holds no operator key/, 'a process without the key cannot sign');
  assert.equal(await chain.refund(H), REC.refund_true.transaction.hash);
  const sent = server.calls.find((c) => c.method === 'send_tx');
  assert.equal(sent?.params.wait_until, 'FINAL');
  sendResult = REC.refund_false;
  await assert.rejects(chain.refund(H), (error: unknown) => error instanceof ChainRejectedError && error.reason === 'ERR_TRANSFER_FAILED');
  sendResult = {
    ...REC.refund_false,
    receipts_outcome: [
      { id: 'transfer', outcome: { status: { Failure: { ActionError: { kind: { AccountDoesNotExist: { account_id: 'gone.testnet' } } } } }, logs: [] } },
      { id: 'callback', outcome: { status: { SuccessValue: 'ZmFsc2U=' }, logs: ['EVENT_JSON:{"event":"refund_failed"}'] } },
    ],
  };
  await assert.rejects(chain.refund(H), (error: unknown) => error instanceof ChainRejectedError && error.reason === 'ERR_TRANSFER_FAILED',
    'a failed transfer receipt is the callback bool, not ERR_TX_FAILED');
  sendResult = REC.attest_bad_status;
  await assert.rejects(chain.markRunning(H), (error: unknown) => error instanceof ChainRejectedError && error.reason === 'ERR_BAD_STATUS');
  assert.ok(!JSON.stringify(server.calls).includes(fs.readFileSync(keyFile, 'utf8').slice(30, 60)), 'the secret never goes over the wire');
  fs.chmodSync(keyFile, 0o644);
  assert.throws(() => loadOperatorKey(keyFile), /must not be readable/);
});

test('guard blocklist: is_reported is a final view; report_address is an operator call with {account_id, evidence_uri, reason}', async () => {
  const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'key-')), 'operator.key');
  fs.writeFileSync(keyFile, JSON.stringify({ account_id: 'operator.testnet', private_key: KeyPair.fromRandom('ed25519').toString() }), { mode: 0o600 });
  const server = await rpc((call) => (call.method === 'send_tx' ? { result: REC.report_address_ok } : registry(call)));
  const reader = adapter([server.url]);
  assert.equal(await reader.isReported('drainer.testnet'), true);
  assert.equal(await reader.isReported('clean.testnet'), false);
  const view = server.calls.find((c) => c.params?.method_name === 'is_reported');
  assert.equal(view?.params.finality, 'final');
  assert.deepEqual(JSON.parse(Buffer.from(view?.params.args_base64, 'base64').toString('utf8')), { account_id: 'drainer.testnet' });
  const verdict = await guardPort(chainReader(reader)).verdict('drainer.testnet');
  assert.equal(verdict.verdict, 'block', 'the guard reads is_reported through registryReader over this adapter');
  assert.ok(verdict.reasons.includes('REPORTED'));
  const report = { accountId: 'drainer.testnet', evidenceUri: 'https://evidence.test/drainer', reason: 'phishing drainer' };
  await assert.rejects(reader.reportAddress(report), /holds no operator key/, 'the API process cannot report');
  assert.equal(await adapter([server.url], () => loadOperatorKey(keyFile)).reportAddress(report), REC.report_address_ok.transaction.hash);
  assert.equal(server.calls.find((c) => c.method === 'send_tx')?.params.wait_until, 'FINAL');

  const old = await rpc((call) => (call.params?.method_name === 'is_reported'
    ? { result: { error: 'wasm execution failed with error: MethodResolveError(MethodNotFound)', logs: [], block_height: 220000000, block_hash: REC.null_view.block_hash } }
    : registry(call)));
  await assert.rejects(adapter([old.url]).isReported('drainer.testnet'), (error: unknown) => error instanceof AppError && error.code === 'CHAIN_UNAVAILABLE',
    'a registry without is_reported is an unavailable signal, not "not reported"');
});
