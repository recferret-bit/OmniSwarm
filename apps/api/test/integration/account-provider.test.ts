// The dashboard review runs on the account's own provider key: refused until a key and models are saved,
// and the models are snapshotted on the request row.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { call, MODELS, queuedJob, signIn } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { migratedDb, startApi, type ApiStack, type TestDb } from '../helpers/stack.ts';

describe('review on an account provider key', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  before(async () => {
    t = await migratedDb('account_provider');
    api = await startApi(t.env);
  });
  after(async () => {
    await api?.close();
    await t?.db.drop();
  });

  test('account-nearai is refused without a saved key, then queued with the saved models', async () => {
    const { cookie } = await signIn(api.base);
    const refused = await call(api.base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo: 'near/near-sdk-rs' } });
    assert.equal(refused.body.error.code, 'PRESET_NOT_ALLOWED');
    assert.match(refused.body.error.message, /Save your NEAR AI Cloud key/);
    const queued = await queuedJob(api.base);
    const row = await api.deps.pool.query<{ preset: string; models: string[]; status: string }>('SELECT preset, models, status FROM request WHERE id = $1', [queued.requestId]);
    assert.deepEqual(row.rows[0], { preset: 'account-nearai', models: MODELS, status: 'queued' });
    const other = await call(api.base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo: 'near/near-sdk-rs', source: 'local' } });
    assert.equal(other.status, 400);
    await api.deps.boss.deleteAllJobs('review');
  });
});
