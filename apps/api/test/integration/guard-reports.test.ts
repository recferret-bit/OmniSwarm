// Guard reports end to end on the mock chain (INTAKE section 4, W13): a signed-in account files a
// report, the owner reviews it on the loopback admin listener, a worker sends `report_address` once,
// and the guard's `is_reported` signal then blocks the account.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { call, conforms, createRequest } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { ADMIN_TOKEN, migratedDb, startAdmin, startApi, startWorkerInProcess, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

const ACCOUNT = 'drainer.testnet';
const REPORT = { account: ACCOUNT, evidenceUrl: 'https://evidence.test/drainer', reason: 'phishing drainer' };
const ADMIN = { 'x-admin-token': ADMIN_TOKEN };

describe('guard reports (mock chain)', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  let admin: { base: string; close(): Promise<void> };
  before(async () => {
    t = await migratedDb('guard');
    api = await startApi(t.env);
    admin = await startAdmin(api.deps);
  });
  after(async () => {
    await admin?.close();
    await api?.close();
    await t?.db.drop();
  });

  const reportTxs = async () => (await api.deps.pool.query(`SELECT count(*)::int AS n FROM mock_chain_tx WHERE method = 'report_address'`)).rows[0].n;

  test('file -> owner approves -> worker reports on chain once -> the guard blocks', async () => {
    assert.equal((await call(api.base, '/api/guard/reports', { method: 'POST', body: REPORT })).status, 401, 'a session is required');
    const reporter = await createRequest(api.base, api.deps.pool);
    const filed = await call(api.base, '/api/guard/reports', { method: 'POST', body: REPORT, cookie: reporter.cookie });
    assert.equal(filed.status, 202, JSON.stringify(filed.body));
    conforms('guard-report-response', filed.body);
    const again = await call(api.base, '/api/guard/reports', { method: 'POST', body: REPORT, cookie: reporter.cookie });
    assert.equal(again.body.reportId, filed.body.reportId, 'an open report is not filed twice');
    const before = await call(api.base, `/api/guard/verdict?account=${ACCOUNT}`);
    assert.ok(!before.body.reasons.includes('REPORTED'), 'nothing is blocked before the owner decides');

    assert.equal((await call(api.base, '/api/admin/guard/reports', { headers: ADMIN })).status, 404, 'not on the public app');
    assert.equal((await call(admin.base, '/api/admin/guard/reports')).status, 401);
    const pending = await call(admin.base, '/api/admin/guard/reports?status=pending', { headers: ADMIN });
    conforms('admin-guard-report-list-response', pending.body);
    assert.deepEqual(pending.body.reports.map((r: { reportId: string }) => r.reportId), [filed.body.reportId]);

    const approve = `/api/admin/guard/reports/${filed.body.reportId}/approve`;
    const approved = await call(admin.base, approve, { method: 'POST', headers: ADMIN });
    assert.equal(approved.status, 202, JSON.stringify(approved.body));
    conforms('admin-guard-decision-response', approved.body);
    assert.equal(await reportTxs(), 0, 'the API never signs');

    const worker = await startWorkerInProcess(t.env);
    try {
      await until(async () => (await call(admin.base, approve, { method: 'POST', headers: ADMIN })).body.status === 'reported');
    } finally {
      await worker.close();
    }
    const done = await call(admin.base, approve, { method: 'POST', headers: ADMIN });
    assert.equal(done.status, 200);
    assert.ok(done.body.reportTx);
    assert.equal(await api.deps.chain.isReported(ACCOUNT), true);
    const blocked = await call(api.base, `/api/guard/verdict?account=${ACCOUNT}`);
    assert.equal(blocked.body.verdict, 'block');
    assert.ok(blocked.body.reasons.includes('REPORTED'));
    const reject = await call(admin.base, `/api/admin/guard/reports/${filed.body.reportId}/reject`, { method: 'POST', headers: ADMIN });
    assert.equal(reject.status, 409);
    assert.equal(reject.body.error.code, 'INVALID_TRANSITION');
  });

  test('a second approved report on a listed account is settled without a second report_address', async () => {
    const other = await createRequest(api.base, api.deps.pool);
    const filed = await call(api.base, '/api/guard/reports', { method: 'POST', body: REPORT, cookie: other.cookie });
    const approve = `/api/admin/guard/reports/${filed.body.reportId}/approve`;
    assert.equal((await call(admin.base, approve, { method: 'POST', headers: ADMIN })).status, 202);
    const worker = await startWorkerInProcess(t.env);
    try {
      const settled = await until(async () => {
        const reply = await call(admin.base, approve, { method: 'POST', headers: ADMIN });
        return reply.body.status === 'reported' ? reply.body : null;
      });
      assert.equal(settled.reportTx, null, 'the chain already listed the account');
    } finally {
      await worker.close();
    }
    assert.equal(await reportTxs(), 1);

    const rejected = await call(api.base, '/api/guard/reports', { method: 'POST', body: { ...REPORT, account: 'honest.testnet' }, cookie: other.cookie });
    const reject = await call(admin.base, `/api/admin/guard/reports/${rejected.body.reportId}/reject`, { method: 'POST', headers: ADMIN });
    assert.deepEqual(reject.body, { status: 'rejected', reportTx: null });
    assert.equal((await call(admin.base, `/api/admin/guard/reports/${crypto.randomUUID()}/approve`, { method: 'POST', headers: ADMIN })).status, 404);
  });
});
