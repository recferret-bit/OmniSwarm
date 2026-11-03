// Horizontal scaling: two API instances on one database share the rate-limit budget and serve each
// other's SSE events (LISTEN/NOTIFY). The admin listener is separate, loopback-only and token-gated.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { appendProgress } from '../../src/db/repositories/progress.ts';
import { chainEvents } from '../../src/chain/mock/mock-ledger.ts';
import { findRequest, transition } from '../../src/db/repositories/requests.ts';
import { call, conforms, createRequest, queuedRequest } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { ADMIN_TOKEN, migratedDb, startAdmin, startApi, startWorkerInProcess, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

function sse(url: string): { events: any[]; ended: Promise<void>; close(): void } {
  const events: any[] = [];
  let request: http.ClientRequest;
  const ended = new Promise<void>((resolve, reject) => {
    request = http.get(url, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = frame.split('\n').find((line) => line.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      });
      res.on('end', () => resolve());
    });
    request.on('error', reject);
  });
  return { events, ended, close: () => request.destroy() };
}

describe('two API replicas on one database', NEEDS_DB, () => {
  let t: TestDb;
  let a: ApiStack;
  let b: ApiStack;
  before(async () => {
    t = await migratedDb('replicas', { RATE_LIMIT_PER_MINUTE: '30' });
    a = await startApi(t.env);
    b = await startApi(t.env);
  });
  after(async () => {
    await a?.close();
    await b?.close();
    await t?.db.drop();
  });

  test('the per-IP challenge budget (30/min) is shared across replicas', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await call(i % 2 ? b.base : a.base, '/api/challenge', { method: 'POST', body: {} })).status);
    assert.equal(statuses.filter((s) => s === 200).length, 30);
    assert.deepEqual(statuses.slice(30), Array(10).fill(429));
    const limited = await call(a.base, '/api/challenge', { method: 'POST', body: {} });
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
    conforms('error-response', limited.body);
    const quote = await call(b.base, '/api/quote', { method: 'POST', body: { repoUrl: 'https://github.com/near/near-sdk-rs', network: 'testnet' } });
    assert.equal(quote.status, 200, 'routes have separate budgets');
    await a.deps.pool.query('DELETE FROM rate_limit');
  });

  test('an SSE stream on replica A gets events written through replica B and ends on done', async () => {
    const created = await createRequest(b.base, b.deps.pool);
    await appendProgress(b.deps.pool, created.requestId, { phase: 'starting', percent: 5 }, new Date());
    const stream = sse(`${a.base}/api/requests/${created.requestId}/events`);
    await until(async () => stream.events.length >= 2);
    const now = new Date();
    await transition(b.deps.pool, created.requestId, { to: 'queued', actor: 'test', event: 'payment_verified', now });
    await transition(b.deps.pool, created.requestId, { to: 'running', actor: 'test', event: 'review_started', now });
    await appendProgress(b.deps.pool, created.requestId, { phase: 'review', reviewer: 'scripted-baseline', pass: 1, percent: 40 }, now);
    await transition(b.deps.pool, created.requestId, { to: 'publishing', actor: 'test', event: 'report_published', now });
    await transition(b.deps.pool, created.requestId, { to: 'done', actor: 'test', event: 'review_attested', now });
    await stream.ended;
    for (const event of stream.events) conforms('progress-event', event);
    assert.deepEqual(stream.events[0].progress, { phase: 'starting', percent: 5 });
    assert.ok(stream.events.some((event) => event.progress?.reviewer === 'scripted-baseline' && event.progress.percent === 40));
    assert.equal(stream.events.at(-1).status, 'done');
    const replay = sse(`${b.base}/api/requests/${created.requestId}/events`);
    await replay.ended;
    assert.equal(replay.events.at(-1).status, 'done', 'a stream for a finished request replays and closes');
    assert.equal((await call(a.base, '/api/requests/3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10/events')).status, 404);
  });

  test('admin: loopback listener, constant-time token, refunds only allowed statuses', async () => {
    const admin = await startAdmin({ ...a.deps });
    try {
      assert.match(admin.base, /^http:\/\/127\.0\.0\.1:/);
      const queued = await queuedRequest(a.base, a.deps.pool);
      const path = `/api/admin/requests/${queued.requestId}/refund`;
      assert.equal((await call(a.base, path, { method: 'POST', headers: { 'x-admin-token': ADMIN_TOKEN } })).status, 404, 'not on the public app');
      assert.equal((await call(admin.base, path, { method: 'POST' })).status, 401);
      assert.equal((await call(admin.base, path, { method: 'POST', headers: { 'x-admin-token': `${ADMIN_TOKEN}x` } })).status, 401);
      const queuedRefund = await call(admin.base, path, { method: 'POST', headers: { 'x-admin-token': ADMIN_TOKEN } });
      assert.equal(queuedRefund.status, 202, JSON.stringify(queuedRefund.body));
      assert.deepEqual(queuedRefund.body, { status: 'refund_queued' }, 'the API records the refund; it holds no key to send it');
      conforms('admin-refund-response', queuedRefund.body);
      assert.equal((await findRequest(a.deps.pool, queued.requestId))?.status, 'queued');
      const twice = await call(admin.base, path, { method: 'POST', headers: { 'x-admin-token': ADMIN_TOKEN } });
      assert.equal(twice.status, 202);
      const jobs = await a.deps.pool.query(`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'refund' AND singleton_key = $1`, [queued.requestHash]);
      assert.equal(jobs.rows[0].n, 1, 'one refund job per request');
      const worker = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_STEP_MS: '3000' });
      try {
        await until(async () => (await findRequest(a.deps.pool, queued.requestId))?.status === 'refunded', 30_000);
      } finally {
        await worker.close();
      }
      const refunded = await call(admin.base, path, { method: 'POST', headers: { 'x-admin-token': ADMIN_TOKEN } });
      assert.equal(refunded.status, 200);
      conforms('admin-refund-response', refunded.body);
      assert.equal(refunded.body.status, 'refunded');
      assert.ok(refunded.body.refundTx);
      assert.equal((await chainEvents(a.deps.pool, queued.requestHash)).filter((e) => e === 'review_refunded').length, 1);
      const unpaid = await createRequest(a.base, a.deps.pool);
      const denied = await call(admin.base, `/api/admin/requests/${unpaid.requestId}/refund`, { method: 'POST', headers: { 'x-admin-token': ADMIN_TOKEN } });
      assert.equal(denied.status, 409);
      assert.equal(denied.body.error.code, 'REFUND_NOT_ALLOWED');
      const log = await a.deps.pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'admin_refund' AND request_id = $1`, [queued.requestId]);
      assert.equal(log.rows[0].n, 1);
    } finally {
      await admin.close();
    }
  });
});
