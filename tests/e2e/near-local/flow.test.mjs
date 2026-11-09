// Headless sandbox flow (W15-15): NEP-413, request_review, mock-engine publish,
// attest, refund, guard verdicts, report_address, withdraw.
// Skips when the sandbox is down or Postgres cannot host a throwaway database.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { evaluate } from '../../../packages/guard/src/engine.mjs';
import { hashReportDir } from '../../../apps/api/src/worker/report.ts';
import { ADMIN_TOKEN, migratedDb, startAdmin, startApi, startWorkerInProcess, until } from '../../../apps/api/test/helpers/stack.ts';
import {
  COMMIT, CONTRACT_ID, PRESET, PRICE_YOCTO, RECIPIENT, REPO, RPC_URL, callView,
  keyFile, loadSigningKey, operatorCallPermission, redact, requestReview, sandboxSkipReason, signRequest, startIndexer, stopChild, withdrawEarned,
} from './sandbox.mjs';
import { redeploy } from '../../../infra/near-local/redeploy.mjs';

const TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ONE_NEAR = '1000000000000000000000000';

function sessionCookie(reply) {
  const list = typeof reply.headers.getSetCookie === 'function' ? reply.headers.getSetCookie() : [reply.headers.get('set-cookie') ?? ''];
  const cookie = list.map((line) => line.split(';')[0] ?? '').find((part) => part.startsWith('sid='));
  assert.ok(cookie, 'sid cookie set');
  return cookie;
}

async function call(base, route, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  const response = await fetch(`${base}${route}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: response.status, body, headers: response.headers };
}

async function postgresSkipReason() {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) return 'DATABASE_URL is not set; Postgres is required to create a throwaway database for the intake flow';
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return '';
  } catch (error) {
    return `Postgres is unreachable (${redact(error instanceof Error ? error.message : error)})`;
  } finally {
    await client.end().catch(() => {});
  }
}

async function skipReason() {
  const reasons = [await sandboxSkipReason(), await postgresSkipReason()].filter(Boolean);
  return reasons.join('; ');
}

async function waitStatus(base, id, wanted) {
  const dead = wanted.includes('refunded') ? ['done', 'expired'] : ['refunded', 'expired', 'failed'];
  return until(async () => {
    const reply = await call(base, `/api/requests/${id}`);
    if (reply.status !== 200) return false;
    const status = reply.body?.status;
    if (wanted.includes(status)) return reply.body;
    if (dead.includes(status)) throw new Error(`request ${id} is ${status}, want ${wanted.join(' or ')}: ${JSON.stringify(reply.body)}`);
    return false;
  }, 150_000, 400);
}

async function confirmPayment(base, created, txHash) {
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    last = await call(base, `/api/requests/${created.requestId}/payment`, {
      method: 'POST', body: { txHash }, cookie: created.cookie,
    });
    if (last.status === 200) return last.body;
    if (last.body?.error?.code !== 'PAYMENT_NOT_FOUND') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(last?.status, 200, JSON.stringify(last?.body));
  return last.body;
}

async function createPaid(base, who) {
  const challenge = await call(base, '/api/challenge', { method: 'POST', body: {} });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
  const signed = signRequest(who, challenge.body.nonce);
  const created = await call(base, '/api/requests', { method: 'POST', body: signed });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.priceYocto, ONE_NEAR);
  assert.equal(created.body.contractId, CONTRACT_ID);
  assert.equal(created.body.priceYocto, PRICE_YOCTO);
  const cookie = sessionCookie(created);
  const txHash = await requestReview(who, created.body.requestHash, created.body.priceYocto);
  assert.match(txHash, TX);
  const paid = await confirmPayment(base, { ...created.body, cookie }, txHash);
  assert.equal(paid.status, 'queued', JSON.stringify(paid));
  return { requestId: created.body.requestId, requestHash: created.body.requestHash, cookie, txHash };
}

function assertVerdictMatches(name, body) {
  assert.equal(typeof body?.verdict, 'string', `${name} ${JSON.stringify(body)}`);
  const severity = body.attestation?.maxSeverity ?? null;
  const expected = evaluate(body.signals, severity);
  assert.equal(body.verdict, expected.verdict, `${name} ${JSON.stringify(body)}`);
  assert.deepEqual(body.reasons, expected.reasons, `${name} reasons`);
}

const reason = await skipReason();

test('alice pays, the mock worker attests, then refund, guard, report_address and withdraw', { timeout: 240_000, skip: reason || false }, async () => {
  const price = await callView(CONTRACT_ID, 'get_price', {});
  assert.equal(String(price), ONE_NEAR, 'registry price is not 1 NEAR; seed the sandbox');
  const alice = loadSigningKey('alice');
  const bob = loadSigningKey('bob');
  assert.equal(alice.accountId, 'alice.test.near');
  assert.equal(bob.accountId, 'bob.test.near');
  let indexer;
  let opened;
  let api;
  let admin;
  let worker;
  let refundWorker;
  let restoreGoodDex = false;
  const previousAge = process.env.GUARD_ACCOUNT_AGE_URL;
  try {
    const operatorKey = await operatorCallPermission();
    assert.deepEqual([...operatorKey.methods].sort(), ['attest', 'mark_running', 'refund', 'report_address']);
    assert.equal(operatorKey.receiver, CONTRACT_ID);
    // Seed grants 1 NEAR. Later operator calls spend it, so a reused sandbox
    // shows a smaller remaining allowance, never a full-access key.
    assert.match(operatorKey.allowance, /^[1-9][0-9]*$/);
    assert.ok(BigInt(operatorKey.allowance) <= BigInt(ONE_NEAR), operatorKey.allowance);
    indexer = await startIndexer();
    process.env.GUARD_ACCOUNT_AGE_URL = indexer.url;
    opened = await migratedDb('w1515', {
      NEAR_NETWORK: 'sandbox',
      NETWORK: 'sandbox',
      CHAIN_ADAPTER: 'near',
      RPC_URLS: RPC_URL,
      CONTRACT_ID,
      INTAKE_RECIPIENT: RECIPIENT,
      PRICE_YOCTO: ONE_NEAR,
      OPERATOR_KEY_FILE: keyFile('operator'),
      HOSTED_PRESET: PRESET,
      REPORTS_BASE_URL: 'http://reports.test',
      ENGINE_RUNNER: 'mock',
      GITHUB_ADAPTER: 'recorded',
      MOCK_ENGINE_STEP_MS: '15',
    });
    api = await startApi(opened.env);
    admin = await startAdmin(api.deps);
    worker = await startWorkerInProcess(opened.env);

    const paid = await createPaid(api.base, alice);
    const done = await waitStatus(api.base, paid.requestId, ['done']);
    assert.match(done.attestTx, TX);
    assert.equal(done.reportUrl, `http://reports.test/${paid.requestId}/report.html`);
    assert.equal(done.reportSha256, hashReportDir(`${opened.env.REPORTS_ROOT}/${paid.requestId}`));
    const attestation = await callView(CONTRACT_ID, 'get_attestation', { request_hash: paid.requestHash });
    assert.equal(attestation?.report_sha256, done.reportSha256, 'get_attestation report hash does not match the recomputed report');
    assert.equal(attestation?.report_uri, `https://reports.test/${paid.requestId}/report.html`);
    assert.equal(attestation?.repo, REPO);
    assert.equal(attestation?.commit, COMMIT);
    const onChain = await callView(CONTRACT_ID, 'get_request', { request_hash: paid.requestHash });
    assert.equal(onChain?.status, 'Done');

    await worker.close();
    worker = null;
    const refundedRequest = await createPaid(api.base, bob);
    refundWorker = await startWorkerInProcess({ ...opened.env, MOCK_ENGINE_FAIL: 'infra' });
    const refunded = await waitStatus(api.base, refundedRequest.requestId, ['refunded']);
    assert.match(refunded.refundTx, TX);
    const refundedOnChain = await callView(CONTRACT_ID, 'get_request', { request_hash: refundedRequest.requestHash });
    assert.equal(refundedOnChain?.status, 'Refunded');

    const verdicts = {};
    for (const account of ['good-dex.test.near', 'drained-vault.test.near', 'phish.test.near']) {
      const reply = await call(api.base, `/api/guard/verdict?account=${encodeURIComponent(account)}&network=sandbox`);
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      verdicts[account] = reply.body;
      assertVerdictMatches(account, reply.body);
    }
    const good = verdicts['good-dex.test.near'];
    const drained = verdicts['drained-vault.test.near'];
    const phish = verdicts['phish.test.near'];
    assert.equal(good.attestation?.maxSeverity, 'low');
    assert.equal(good.signals.codeHashMatches, true);
    assert.ok(good.reasons.includes('ATTESTED_CLEAN'), JSON.stringify(good.reasons));
    if (typeof good.signals.ageDays === 'number' && good.signals.ageDays < 30) {
      assert.equal(good.verdict, 'warn');
      assert.ok(good.reasons.includes('ACCOUNT_TOO_NEW'), good.reasons.join(','));
    } else if (Array.isArray(good.signals.unavailable) && good.signals.unavailable.includes('accountAge')) {
      assert.equal(good.verdict, 'warn');
      assert.ok(good.reasons.includes('SIGNAL_UNAVAILABLE'), good.reasons.join(','));
    } else {
      assert.equal(good.verdict, 'allow', JSON.stringify(good));
    }
    assert.equal(drained.verdict, 'block');
    assert.equal(drained.attestation?.maxSeverity, 'critical');
    assert.ok(drained.reasons.includes('ATTESTED_CRITICAL_STILL_DEPLOYED'), drained.reasons.join(','));
    assert.equal(phish.verdict, 'block');
    assert.equal(phish.signals.reported, true);
    assert.ok(phish.reasons.includes('REPORTED'), phish.reasons.join(','));

    const reportedAccount = `w1515${crypto.randomBytes(4).toString('hex')}.test.near`;
    const filed = await call(api.base, '/api/guard/reports', {
      method: 'POST',
      cookie: paid.cookie,
      body: { account: reportedAccount, evidenceUrl: 'https://omniswarm.localhost/evidence/w15-15', reason: 'headless e2e report' },
    });
    assert.equal(filed.status, 202, JSON.stringify(filed.body));
    const approved = await call(admin.base, `/api/admin/guard/reports/${filed.body.reportId}/approve`, {
      method: 'POST',
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    assert.equal(approved.status, 202, JSON.stringify(approved.body));
    const reported = await until(async () => {
      const reply = await call(admin.base, '/api/admin/guard/reports', { headers: { 'x-admin-token': ADMIN_TOKEN } });
      if (reply.status !== 200) return false;
      const row = reply.body.reports?.find((item) => item.reportId === filed.body.reportId);
      if (row?.status === 'reported' && row.reportTx) return row;
      if (row?.status === 'rejected') throw new Error('guard report was rejected');
      return false;
    }, 90_000, 400);
    assert.match(reported.reportTx, TX);
    assert.equal(await callView(CONTRACT_ID, 'is_reported', { account_id: reportedAccount }), true);

    const withdrawn = await withdrawEarned();
    assert.match(withdrawn.txHash, TX);
    assert.ok(withdrawn.treasuryAfter > withdrawn.treasuryBefore, 'treasury balance did not rise');

    await redeploy({ name: 'good-dex', alt: true });
    restoreGoodDex = true;
    const drifted = await call(api.base, '/api/guard/verdict?account=good-dex.test.near&network=sandbox');
    assert.equal(drifted.status, 200, JSON.stringify(drifted.body));
    assert.equal(drifted.body.verdict, 'warn', JSON.stringify(drifted.body));
    assert.ok(drifted.body.reasons.includes('CODE_CHANGED_SINCE_REVIEW'), drifted.body.reasons.join(','));
    await redeploy({ name: 'good-dex', alt: false });
    restoreGoodDex = false;

    const lines = [
      `request_review=${paid.txHash}`,
      `attest=${done.attestTx}`,
      `refund_request_review=${refundedRequest.txHash}`,
      `refund=${refunded.refundTx}`,
      `report_address=${reported.reportTx}`,
      `withdraw=${withdrawn.txHash}`,
    ];
    console.log(`W15-15 tx ${lines.join(' ')}`);
    console.log(`W15-15 guard good-dex=${good.verdict}:${good.reasons.join('+')} drained-vault=${drained.verdict}:${drained.reasons.join('+')} phish=${phish.verdict}:${phish.reasons.join('+')}`);
  } finally {
    if (restoreGoodDex) {
      await redeploy({ name: 'good-dex', alt: false }).catch((error) => {
        console.error(redact(error instanceof Error ? error.message : error));
      });
    }
    if (previousAge === undefined) delete process.env.GUARD_ACCOUNT_AGE_URL;
    else process.env.GUARD_ACCOUNT_AGE_URL = previousAge;
    await worker?.close().catch((error) => console.error(redact(error instanceof Error ? error.message : error)));
    await refundWorker?.close().catch((error) => console.error(redact(error instanceof Error ? error.message : error)));
    await admin?.close().catch((error) => console.error(redact(error instanceof Error ? error.message : error)));
    await api?.close().catch((error) => console.error(redact(error instanceof Error ? error.message : error)));
    await opened?.db.drop().catch((error) => console.error(redact(error instanceof Error ? error.message : error)));
    await stopChild(indexer?.child);
  }
});
