import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fingerprintOf, providerStatus, readProviderEnv, writeProviderSecrets } from '../../src/modules/providers/secrets.ts';
import { accountConfigDocument, jobSpecs, panelConfigDocument, panelPresetName, panelSpecs } from '../../src/worker/panel.ts';
import { accountKeyStatus, cleanModels, listProviderModels, readAccountKey, writeAccountKey } from '../../src/modules/providers/account-keys.ts';
import { presetEnv } from '../../src/worker/preset.ts';
import { prepareProviders } from '../../src/worker/review-handler.ts';
import type { Config } from '../../src/config/load.ts';
import type { Pool } from '../../src/db/pool.ts';
import type { RequestRow } from '../../src/db/repositories/requests.ts';

test('the panel always reviews with GLM and Qwen, and adds the chosen models in order', () => {
  assert.equal(panelPresetName([]), 'panel');
  assert.equal(panelPresetName(['grok', 'opus']), 'panel-opus-grok');
  assert.throws(() => panelPresetName(['claude']), /unknown model/);
  const specs = panelSpecs('panel-opus-grok');
  assert.deepEqual(specs.reviewers, [
    'key:zai:glm-5.3',
    'openrouter:qwen/qwen3.8-max-0902',
    'openrouter:anthropic/claude-opus-5.5',
    'openrouter:x-ai/grok-4.7',
  ]);
  assert.equal(specs.orchestrator, 'key:zai:glm-5.3');
  assert.equal(specs.alternateJudge, 'openrouter:qwen/qwen3.8-max-0902');
  const doc = panelConfigDocument('panel') as { presets: { panel: { orchestrator: string } } };
  assert.equal(doc.presets.panel.orchestrator, 'key:zai:glm-5.3');
});

test('provider keys are stored sealed and only a fingerprint comes back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-keys-'));
  const file = path.join(dir, 'providers.json');
  const secret = 's'.repeat(40);
  const status = writeProviderSecrets(file, secret, { zai: 'zai-secret-value', openrouter: 'or-secret-value' });
  assert.equal(status.zai?.fingerprint, fingerprintOf('zai-secret-value'));
  assert.equal(status.openrouter?.set, true);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('zai-secret-value'));
  assert.ok(!raw.includes('or-secret-value'));
  assert.deepEqual(readProviderEnv(file, secret), { ZAI_API_KEY: 'zai-secret-value', OPENROUTER_API_KEY: 'or-secret-value' });
  assert.equal(writeProviderSecrets(file, secret, { zai: '' }).zai?.set, false);
  assert.equal(providerStatus(file).openrouter?.set, true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
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
  const view = await writeAccountKey(pool, SECRET, 'alice', 'nearai', { key: 'near-secret-value', models: ['deepseek-ai/DeepSeek-V4', 'zai-org/GLM-5.3'] }, now);
  assert.equal(view.set, true);
  assert.equal(view.fingerprint, fingerprintOf('near-secret-value'));
  assert.deepEqual(view.models, ['deepseek-ai/DeepSeek-V4', 'zai-org/GLM-5.3']);
  assert.equal(view.label, 'NEAR AI Cloud');
  assert.ok(!JSON.stringify(view).includes('near-secret-value'));
  assert.equal(await readAccountKey(pool, SECRET, 'alice', 'nearai'), 'near-secret-value');
  assert.equal(await readAccountKey(pool, SECRET, 'bob', 'nearai'), null);
  assert.equal(await readAccountKey(pool, 'r'.repeat(40), 'alice', 'nearai'), null, 'a rotated secret reads as no key');
  // A sealed row copied under another account does not open there (account and provider are the AAD).
  const raw = (await pool.query('SELECT', ['alice', 'nearai'])).rows[0] as Record<string, unknown>;
  await pool.query('INSERT', ['bob', 'nearai', raw.iv, raw.tag, raw.data, raw.fingerprint, raw.models]);
  assert.equal(await readAccountKey(pool, SECRET, 'bob', 'nearai'), null);
  await assert.rejects(writeAccountKey(pool, SECRET, 'alice', 'zai', { key: 'x' }, now), /does not take account keys/);
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
  assert.throws(() => accountConfigDocument('panel', ['m']), /not an account preset/);
  assert.deepEqual(presetEnv('account-nearai', jobSpecs('account-nearai', ['a/one'])).envNames, ['NEARAI_API_KEY']);
  assert.deepEqual(presetEnv('panel', jobSpecs('panel', null)).envNames, ['OPENROUTER_API_KEY', 'ZAI_API_KEY', 'ZAI_BASE_URL']);
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
  assert.deepEqual(await listProviderModels('zai', 'k', ok), { source: 'unavailable', models: [] }, 'a provider without a models endpoint');
});

function jobRow(extra: Partial<RequestRow>): RequestRow {
  return {
    id: 'r1', account: 'alice', repo: 'near/x', commit_sha: 'a'.repeat(40), network: 'sandbox', preset: 'panel', deployed: null,
    request_hash: 'h', price_yocto: '0', status: 'running', attempts: 0, failure_cause: null, report_sha256: null, report_url: null,
    max_severity: null, scope: 'full', theme: null, parent_id: null, slice_path: null, models: null, incomplete: null, attest_tx: null,
    refund_tx: null, queued_at: null, created_at: new Date(), updated_at: new Date(), ...extra,
  };
}

test('the worker runs an account job on that account\'s key only, a panel job on operator keys only, and fails a job with no key', async () => {
  const pool = memoryPool();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-prepare-'));
  const secretsFile = path.join(dir, 'providers.json');
  writeProviderSecrets(secretsFile, SECRET, { zai: 'zai-op', openrouter: 'or-op' });
  const config = { accountKeysSecret: SECRET, providerSecretsFile: secretsFile, http: { sessionSecret: SECRET } } as unknown as Config;
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

  assert.deepEqual(await prepareProviders({ config, pool }, jobRow({ preset: 'account-nearai', account: 'bob', models: ['a/one'] }), dir), { failed: 'nearai_account_key_or_models_missing' });
  assert.deepEqual(await prepareProviders({ config, pool }, jobRow({ preset: 'account-nearai', models: null }), dir), { failed: 'nearai_account_key_or_models_missing' });

  const panel = await prepareProviders({ config, pool }, jobRow({ preset: 'panel-opus' }), dir);
  assert.ok(!('failed' in panel));
  if ('failed' in panel) return;
  assert.deepEqual(panel.providerEnv, { ZAI_API_KEY: 'zai-op', OPENROUTER_API_KEY: 'or-op' });
  assert.deepEqual(panel.providerScope?.sort(), ['OPENROUTER_API_KEY', 'ZAI_API_KEY', 'ZAI_BASE_URL']);
  assert.deepEqual(JSON.parse(fs.readFileSync(panel.configFile!, 'utf8')), panelConfigDocument('panel-opus'));
});
