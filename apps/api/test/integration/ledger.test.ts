// GET /api/ledger (W09-18) after real worker runs: a done and a refunded request appear with their
// deposit, recorded model cost and refund; an unpaid request does not; no account id appears.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { findRequest } from '../../src/db/repositories/requests.ts';
import { call, conforms, createRequest, queuedRequest } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { migratedDb, PRICE, startApi, startWorkerInProcess, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

describe('public ledger', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  before(async () => {
    t = await migratedDb('ledger');
    api = await startApi(t.env);
  });
  after(async () => {
    await api?.close();
    await t?.db.drop();
  });

  const settled = (id: string, status: string) => until(async () => (await findRequest(api.deps.pool, id))?.status === status, 30_000);

  test('rows and totals for paid requests, costs recorded on publish and refund, no accounts', async () => {
    const empty = await call(api.base, '/api/ledger');
    assert.deepEqual(empty.body, { entries: [], totals: { requests: 0, salesYocto: '0', refundedYocto: '0', modelCostUsd: 0 } });

    let worker = await startWorkerInProcess(t.env);
    const done = await queuedRequest(api.base, api.deps.pool);
    await settled(done.requestId, 'done');
    await worker.close();
    worker = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_FAIL: 'infra' });
    const refunded = await queuedRequest(api.base, api.deps.pool);
    await settled(refunded.requestId, 'refunded');
    await worker.close();
    const unpaid = await createRequest(api.base, api.deps.pool);

    const ledger = await call(api.base, '/api/ledger');
    assert.equal(ledger.status, 200);
    conforms('ledger-response', ledger.body);
    const ids = ledger.body.entries.map((e: { requestId: string }) => e.requestId);
    assert.deepEqual(ids, [refunded.requestId, done.requestId], 'newest payment first; unpaid requests are not sales');
    assert.ok(!ids.includes(unpaid.requestId));
    const [r, d] = ledger.body.entries;
    assert.deepEqual({ status: d.status, paid: d.paidYocto, reviewers: d.reviewers, cost: d.modelCostUsd }, { status: 'done', paid: PRICE, reviewers: 1, cost: 0 });
    assert.equal(r.status, 'refunded');
    assert.ok(r.refundTx);
    assert.deepEqual(ledger.body.totals, { requests: 2, salesYocto: PRICE, refundedYocto: PRICE, modelCostUsd: 0 });
    const costs = await api.deps.pool.query('SELECT request_id FROM request_cost ORDER BY request_id');
    assert.deepEqual(costs.rows.map((row) => row.request_id).sort(), [done.requestId, refunded.requestId].sort(), 'recorded on publish and on refund');
    assert.doesNotMatch(JSON.stringify(ledger.body), /\.mock"/, 'no account id leaves the ledger');
  });
});
