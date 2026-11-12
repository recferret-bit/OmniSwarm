import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fingerprintOf, open, seal } from '../../src/modules/providers/seal.ts';
import { accountConfigDocument } from '../../src/worker/account-config.ts';
import { accountKeyStatus, cleanModels, listProviderModels, readAccountKey, writeAccountKey } from '../../src/modules/providers/account-keys.ts';
import { presetEnv } from '../../src/worker/preset.ts';
import { prepareProviders } from '../../src/worker/review-handler.ts';
import type { Config } from '../../src/config/load.ts';
import type { Pool } from '../../src/db/pool.ts';
import type { RequestRow } from '../../src/db/repositories/requests.ts';

test('a sealed value opens only with the same secret and owner, and its fingerprint is 4+4 hex of the sha256', () => {
  const secret = 's'.repeat(40);
  const sealed = seal(secret, 'near-secret-value', 'account:nearai:alice');
  assert.ok(!JSON.stringify(sealed).includes('near-secret-value'));
  assert.equal(sealed.fingerprint, fingerprintOf('near-secret-value'));
  assert.match(sealed.fingerprint, /^[0-9a-f]{8}$/);
  assert.equal(open(secret, sealed, 'account:nearai:alice'), 'near-secret-value');
  assert.throws(() => open(secret, sealed, 'account:nearai:bob'));
  assert.throws(() => open('r'.repeat(40), sealed, 'account:nearai:alice'));
});

const SECRET = 's'.repeat(40);

/** A Postgres stand-in for account_provider_key: one in-memory table behind the two statements the repository sends. */
function memoryPool(): Pool {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    async query(sql: string, values: unknown[]) {
      const key = `${values[0]}\u0000${values[1]}`;
      if (sql.startsWith('SELECT')) return { rows: rows.has(key) ? [rows.get(key)] : [] };
      if (sql.startsWith('DELETE')) { rows.delete(key); return { rows: [] }; }
      const [account, provider, iv, tag, data, fingerprint, models] = values;
      rows.set(key, { account, provider, iv, tag, data, fingerprint, models });
      return { rows: [] };
    },
  } as unknown as Pool;
}

test('an account key is sealed per account and provider, and only a fingerprint and the models come back', async () => {
  const pool = memoryPool();
  const now = new Date();
  const view = await writeAccountKey(pool, SECRET, 'alice', 'nearai', { key: 'near-secret-value', models: ['deepseek-ai/DeepSeek-V4', 'Qwen/Qwen3.8-Max'] }, now);
  assert.equal(view.set, true);
  assert.equal(view.fingerprint, fingerprintOf('near-secret-value'));
  assert.deepEqual(view.models, ['deepseek-ai/DeepSeek-V4', 'Qwen/Qwen3.8-Max']);
  assert.equal(view.label, 'NEAR AI Cloud');
  assert.ok(!JSON.stringify(view).includes('near-secret-value'));
  assert.equal(await readAccountKey(pool, SECRET, 'alice', 'nearai'), 'near-secret-value');
  assert.equal(await readAccountKey(pool, SECRET, 'bob', 'nearai'), null);
  assert.equal(await readAccountKey(pool, 'r'.repeat(40), 'alice', 'nearai'), null, 'a rotated secret reads as no key');
  // A sealed row copied under another account does not open there (account and provider are the AAD).
  const raw = (await pool.query('SELECT', ['alice', 'nearai'])).rows[0] as Record<string, unknown>;
  await pool.query('INSERT', ['bob', 'nearai', raw.iv, raw.tag, raw.data, raw.fingerprint, raw.models]);
  assert.equal(await readAccountKey(pool, SECRET, 'bob', 'nearai'), null);
  await assert.rejects(writeAccountKey(pool, SECRET, 'alice', 'local', { key: 'x' }, now), /does not take account keys/);
  await assert.rejects(writeAccountKey(pool, SECRET, 'alice', 'removed-provider', { key: 'x' }, now), /does not take account keys/);
  await assert.rejects(writeAccountKey(pool, 'short', 'alice', 'nearai', { key: 'x' }, now), /ACCOUNT_KEYS_SECRET/);
  await assert.rejects(writeAccountKey(pool, SECRET, 'alice', 'nearai', { models: ['a b'] }, now), /invalid model id/);
});

test('saving models keeps the key, an empty key clears it, and a row with nothing left is removed', async () => {
  const pool = memoryPool();
  const now = new Date();
  await writeAccountKey(pool, SECRET, 'alice', 'nearai', { key: 'k-1' }, now);
  assert.deepEqual((await writeAccountKey(pool, SECRET, 'alice', 'nearai', { models: ['m1'] }, now)).fingerprint, fingerprintOf('k-1'));
  assert.equal((await writeAccountKey(pool, SECRET, 'alice', 'nearai', { key: '' }, now)).set, false);
  assert.deepEqual((await accountKeyStatus(pool, 'alice', 'nearai')).models, ['m1']);
  await writeAccountKey(pool, SECRET, 'alice', 'nearai', { models: [] }, now);
  assert.equal((await pool.query('SELECT', ['alice', 'nearai'])).rows.length, 0);
});

test('model ids are trimmed, de-duplicated, shape-checked and capped', () => {
  assert.deepEqual(cleanModels([' a/b ', 'a/b', '', 'c:d.e-f_g']), ['a/b', 'c:d.e-f_g']);
  assert.throws(() => cleanModels(['a b']), /invalid model id/);
  assert.throws(() => cleanModels(['a,b']), /invalid model id/);
  assert.throws(() => cleanModels(['1', '2', '3', '4', '5', '6', '7']), /at most/);
});

test('an account preset: first model orchestrates, all review, and only that provider\'s variable is needed', () => {
  const two = accountConfigDocument('account-nearai', ['a/one', 'b/two']) as { presets: Record<string, Record<string, unknown>> };
  assert.deepEqual(two.presets['account-nearai']?.reviewers, ['nearai:a/one', 'nearai:b/two']);
  assert.equal(two.presets['account-nearai']?.orchestrator, 'nearai:a/one');
  assert.equal(two.presets['account-nearai']?.alternateJudge, 'nearai:b/two');
  const one = accountConfigDocument('account-nearai', ['a/one']) as { presets: Record<string, Record<string, unknown>> };
  assert.equal('alternateJudge' in (one.presets['account-nearai'] ?? {}), false);
  assert.throws(() => accountConfigDocument('account-nearai', []), /at least one model/);
  assert.throws(() => accountConfigDocument('hosted', ['m']), /not an account preset/);
  assert.deepEqual(presetEnv('account-nearai', ['nearai:a/one', 'nearai:b/two']).envNames, ['NEARAI_API_KEY']);
  assert.throws(() => presetEnv('x', ['cli:claude:opus']), /does not run/);
  assert.throws(() => presetEnv('x', ['key:anthropic:claude-opus-5-5']), /does not run/);
});

test('the model list is fetched from the provider catalog endpoint with the key and never throws', async () => {
  const calls: Array<{ url: string; auth: string }> = [];
  const ok = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>).authorization! });
    return new Response(JSON.stringify({ data: [{ id: 'b/two' }, { id: 'a/one' }, { id: 'bad id' }, { id: 'a/one' }, {}] }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await listProviderModels('nearai', 'k', ok), { source: 'live', models: ['a/one', 'b/two'] });
  assert.deepEqual(calls, [{ url: 'https://cloud-api.near.ai/v1/models', auth: 'Bearer k' }]);
  assert.deepEqual(await listProviderModels('nearai', 'k', (async () => new Response('no', { status: 401 })) as unknown as typeof fetch), { source: 'unavailable', models: [] });
  assert.deepEqual(await listProviderModels('nearai', 'k', (async () => { throw new Error('down'); }) as unknown as typeof fetch), { source: 'unavailable', models: [] });
  assert.deepEqual(await listProviderModels('local', 'k', ok), { source: 'unavailable', models: [] }, 'a provider without a models endpoint');
});

function jobRow(extra: Partial<RequestRow>): RequestRow {
  return {
    id: 'r1', account: 'alice', repo: 'near/x', commit_sha: 'a'.repeat(40), network: 'sandbox', preset: 'account-nearai', deployed: null,
    request_hash: 'h', price_yocto: '0', status: 'running', attempts: 0, failure_cause: null, report_sha256: null, report_url: null,
    max_severity: null, scope: 'full', theme: null, parent_id: null, slice_path: null, models: null, incomplete: null, attest_tx: null,
    refund_tx: null, queued_at: null, created_at: new Date(), updated_at: new Date(), ...extra,
  };
}

test('the worker runs an account job on that account\'s key only, a hosted preset on no stored key, and fails a job with no key', async () => {
  const pool = memoryPool();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-prepare-'));
  const engineConfig = path.join(dir, 'omniswarm.config.json');
  fs.writeFileSync(engineConfig, JSON.stringify({ presets: { hosted: { reviewers: ['nearai:deepseek-ai/DeepSeek-V4'], orchestrator: 'nearai:Qwen/Qwen3.8-Max' } } }));
  const config = { accountKeysSecret: SECRET, http: { sessionSecret: SECRET }, engine: { configPath: engineConfig } } as unknown as Config;
  await writeAccountKey(pool, SECRET, 'alice', 'nearai', { key: 'near-alice', models: ['a/one'] }, new Date());

  const own = await prepareProviders({ config, pool }, jobRow({ preset: 'account-nearai', models: ['a/one', 'b/two'] }), dir);
  assert.ok(!('failed' in own));
  if ('failed' in own) return;
  assert.deepEqual(own.providerEnv, { NEARAI_API_KEY: 'near-alice' });
  assert.deepEqual(own.providerScope, ['NEARAI_API_KEY']);
  // The snapshot on the row decides the models, not the account's current choice.
  assert.deepEqual(JSON.parse(fs.readFileSync(own.configFile!, 'utf8')), accountConfigDocument('account-nearai', ['a/one', 'b/two']));
  // A theme child carries the parent's account, so it reads the same key.
  const child = await prepareProviders({ config, pool }, jobRow({ preset: 'account-nearai', models: ['a/one'], parent_id: 'p1', theme: 'web3' }), dir);
  assert.deepEqual('failed' in child ? null : child.providerEnv, { NEARAI_API_KEY: 'near-alice' });
  // A step-by-step review and its follow-up advice or debate step (parent_id + debate_rounds, models copied from the
  // parent) run on the same key and scope, with the pipeline mode in the engine's config. The engine side resolves
  // this exact document in engine/scripts/provider-nearai.test.mjs (ACCOUNT_NEARAI_STEP_DOC).
  for (const row of [
    jobRow({ preset: 'account-nearai', models: ['a/one', 'b/two'], pipeline_mode: 'step-by-step' }),
    jobRow({ preset: 'account-nearai', models: ['a/one', 'b/two'], pipeline_mode: 'step-by-step', parent_id: 'p1', debate_rounds: 1 }),
  ]) {
    const step = await prepareProviders({ config, pool }, row, dir);
    assert.ok(!('failed' in step));
    if ('failed' in step) return;
    assert.deepEqual(step.providerEnv, { NEARAI_API_KEY: 'near-alice' });
    assert.deepEqual(step.providerScope, ['NEARAI_API_KEY']);
    assert.deepEqual(JSON.parse(fs.readFileSync(step.configFile!, 'utf8')), {
      reviewers: ['nearai:a/one', 'nearai:b/two'],
      orchestrator: 'nearai:a/one',
      pipelineMode: 'step-by-step',
      concurrency: 3,
      presets: {
        'account-nearai': {
          reviewers: ['nearai:a/one', 'nearai:b/two'], orchestrator: 'nearai:a/one', alternateJudge: 'nearai:b/two',
          assign: 'matrix', passes: 2, toolBudget: 30, maxCostUsd: 25, pipelineMode: 'step-by-step', concurrency: 3,
        },
      },
    });
  }

  assert.deepEqual(await prepareProviders({ config, pool }, jobRow({ preset: 'account-nearai', account: 'bob', models: ['a/one'] }), dir), { failed: 'nearai_account_key_or_models_missing' });
  assert.deepEqual(await prepareProviders({ config, pool }, jobRow({ preset: 'account-nearai', models: null }), dir), { failed: 'nearai_account_key_or_models_missing' });

  // A configured hosted preset gets no stored key: only the scope of its own specs (the worker's env supplies them).
  const hosted = await prepareProviders({ config, pool }, jobRow({ preset: 'hosted' }), dir);
  assert.deepEqual(hosted, { providerEnv: {}, providerScope: ['NEARAI_API_KEY'] });
  // A request left over from the removed operator panel resolves to nothing and carries no key.
  assert.deepEqual(await prepareProviders({ config, pool }, jobRow({ preset: 'panel' }), dir), { providerEnv: {} });
});
