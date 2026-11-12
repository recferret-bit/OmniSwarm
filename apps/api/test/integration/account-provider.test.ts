// A signed (NEP-413) request on the account's own provider key: preset `account-<provider>` is accepted only
// when the operator lists it in ALLOWED_PRESETS, needs a key and models the account saved while signed in,
// and snapshots those models on the request row.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { call, challenge, sessionCookie, sign, wallet } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { migratedDb, startApi, type ApiStack, type TestDb } from '../helpers/stack.ts';

describe('signed request on an account provider key', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  before(async () => {
    t = await migratedDb('account_provider', { ALLOWED_PRESETS: 'scripted,account-nearai', ACCOUNT_KEYS_SECRET: 'k'.repeat(40) });
    api = await startApi(t.env);
  });
  after(async () => {
    await api?.close();
    await t?.db.drop();
  });

  test('account-nearai is refused without a saved key, then queued with the saved models', async () => {
    const dev = await wallet(api.deps.pool, 'dana.mock');
    // First request on the hosted preset signs the account in (sid cookie). It stays awaiting_payment, which does
    // not count as an active review, so the account can save its key and sign the next request on it.
    const first = await call(api.base, '/api/requests', { method: 'POST', body: sign(dev, await challenge(api.base)) });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const cookie = sessionCookie(first);

    const refused = await call(api.base, '/api/requests', { method: 'POST', body: sign(dev, await challenge(api.base), { preset: 'account-nearai' }) });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'PRESET_NOT_ALLOWED');
    assert.match(refused.body.error.message, /Save your NEAR AI Cloud key/);

    const saved = await call(api.base, '/api/account/providers/nearai', { method: 'PUT', body: { key: 'near-test-key-not-real-0000', models: ['zai-org/GLM-5.3', 'deepseek-ai/DeepSeek-V4'] }, cookie });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const created = await call(api.base, '/api/requests', { method: 'POST', body: sign(dev, await challenge(api.base), { preset: 'account-nearai' }) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const row = await api.deps.pool.query<{ preset: string; models: string[] }>('SELECT preset, models FROM request WHERE id = $1', [created.body.requestId]);
    assert.deepEqual(row.rows[0], { preset: 'account-nearai', models: ['zai-org/GLM-5.3', 'deepseek-ai/DeepSeek-V4'] });

    const other = await call(api.base, '/api/requests', { method: 'POST', body: sign(await wallet(api.deps.pool, 'eve.mock'), await challenge(api.base), { preset: 'account-zai' }) });
    assert.equal(other.body.error.code, 'PRESET_NOT_ALLOWED');
  });
});
