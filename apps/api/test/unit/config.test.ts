import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ConfigError, loadConfig, sandboxRpcUrl } from '../../src/config/load.ts';
import { createChain, createEngine, createGitHub } from '../../src/container.ts';
import { createPool } from '../../src/db/pool.ts';
import { APP_ROOT, REPO_ROOT } from '../../src/shared/paths.ts';

const BASE = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db', SESSION_SECRET: 's'.repeat(40), INTAKE_RECIPIENT: 'omniswarm.testnet', CONTRACT_ID: 'registry.testnet',
};
const PROD = {
  ...BASE, NODE_ENV: 'production', ADMIN_TOKEN: 't'.repeat(40), RPC_URLS: 'https://rpc.testnet.fastnear.com',
  REPORTS_BASE_URL: 'https://reports.example', OPERATOR_KEY_FILE: '/run/credentials/omniswarm-worker@1/operator-key', HOSTED_PRESET: 'hosted',
};

function issue(role: Parameters<typeof loadConfig>[0], env: Record<string, string | undefined>): string {
  try {
    loadConfig(role, env as NodeJS.ProcessEnv);
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error.message;
  }
  return '';
}

test('a missing DATABASE_URL exits with one line naming the key', () => {
  const run = spawnSync(process.execPath, [path.join(APP_ROOT, 'src/bin/api.ts')], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(run.status, 1);
  const lines = run.stderr.trim().split('\n');
  assert.equal(lines.length, 1, run.stderr);
  assert.match(lines[0] ?? '', /^invalid environment: .*DATABASE_URL/);
});

test('no secret has a default', () => {
  assert.match(issue('api', { ...BASE, SESSION_SECRET: undefined }), /SESSION_SECRET is required/);
  assert.match(issue('api', { ...BASE, SESSION_SECRET: 'dev-session-secret' }), /SESSION_SECRET must be at least 32/);
  assert.match(issue('api', { ...BASE, ADMIN_TOKEN: 'dev-admin' }), /ADMIN_TOKEN must be at least 32/);
  assert.equal(loadConfig('api', BASE).admin.token, null, 'without a token the admin listener is off');
});

test('production refuses test adapters, a missing admin token and insecure cookies', () => {
  assert.equal(issue('api', PROD), '');
  assert.equal(issue('worker', PROD), '');
  assert.match(issue('api', { ...PROD, ADMIN_TOKEN: undefined }), /ADMIN_TOKEN is required in production/);
  assert.match(issue('api', { ...PROD, CHAIN_ADAPTER: 'mock' }), /CHAIN_ADAPTER must be "near"/);
  assert.match(issue('api', { ...PROD, NETWORK: 'sandbox' }), /NETWORK sandbox is the local near-sandbox/);
  assert.match(issue('api', { ...PROD, NEAR_NETWORK: 'sandbox' }), /NEAR_NETWORK sandbox is the local near-sandbox/);
  assert.equal(issue('api', { ...BASE, NETWORK: 'sandbox' }), '', 'sandbox is allowed outside production');
  assert.equal(loadConfig('api', { ...BASE, NETWORK: 'sandbox' }).chain.adapter, 'mock', 'NETWORK=sandbox alone does not select the near adapter');
  assert.equal(loadConfig('api', { ...BASE, NETWORK: 'sandbox' }).intake.priceYocto, null, 'NETWORK=sandbox alone has no default price');
  assert.equal(loadConfig('api', PROD).chain.adapter, 'near', 'production defaults to the real adapters');
  assert.equal(loadConfig('worker', PROD).engine.runner, 'cli');
  assert.match(issue('worker', { ...PROD, OPERATOR_KEY_FILE: undefined }), /OPERATOR_KEY_FILE is required/);
  assert.equal(issue('api', { ...PROD, OPERATOR_KEY_FILE: undefined }), '', 'the API never needs the operator key');
  assert.match(issue('api', { ...PROD, GITHUB_ADAPTER: 'recorded' }), /GITHUB_ADAPTER/);
  assert.match(issue('worker', { ...PROD, ENGINE_RUNNER: 'mock' }), /ENGINE_RUNNER/);
  assert.match(issue('worker', { ...PROD, REPORTS_BASE_URL: undefined }), /REPORTS_BASE_URL/);
  assert.match(issue('api', { ...PROD, REPORTS_BASE_URL: 'http://reports.example' }), /REPORTS_BASE_URL must be https in production/);
  assert.equal(loadConfig('worker', { ...BASE, REPORTS_BASE_URL: 'http://reports.localhost:18480' }).storage.reportsBaseUrl, 'http://reports.localhost:18480');
  assert.match(issue('api', { ...PROD, COOKIE_SECURE: '0' }), /COOKIE_SECURE/);
  assert.equal(loadConfig('api', PROD).http.cookieSecure, true);
  for (const role of ['api', 'worker'] as const) assert.match(issue(role, { ...PROD, HOSTED_PRESET: undefined }), /HOSTED_PRESET must be set in production/);
  assert.equal(loadConfig('api', BASE).intake.hostedPreset, 'hosted', 'outside production the default is the hosted preset');
});

test('the factories refuse test adapters in production even if config were bypassed', async () => {
  const config = loadConfig('api', BASE);
  const prod = { ...config, env: 'production' as const };
  const pool = createPool(config.db.url, 1);
  await assert.rejects(createChain(prod, pool), /test adapter/);
  await assert.rejects(createGitHub(prod), /test adapter/);
  await assert.rejects(createEngine({ ...prod, engine: { ...prod.engine, runner: 'mock' } }), /test adapter/);
  await pool.end();
});

test('admin binds loopback only; presets must be allow-listed; trustProxy parses', () => {
  assert.match(issue('api', { ...BASE, ADMIN_HOST: '0.0.0.0' }), /ADMIN_HOST admin listener binds loopback only/);
  assert.match(issue('api', { ...BASE, HOSTED_PRESET: 'hosted', ALLOWED_PRESETS: 'scripted' }), /HOSTED_PRESET must be one of ALLOWED_PRESETS/);
  assert.equal(loadConfig('api', { ...BASE, TRUST_PROXY: '1' }).http.trustProxy, 1);
  assert.deepEqual(loadConfig('api', { ...BASE, TRUST_PROXY: '127.0.0.1,10.0.0.0/8' }).http.trustProxy, ['127.0.0.1', '10.0.0.0/8']);
  assert.equal(loadConfig('api', BASE).http.trustProxy, false);
  assert.equal(loadConfig('api', { ...BASE, NETWORK: 'mainnet' }).intake.priceYocto, null, 'mainnet is off until priced');
  assert.equal(issue('migrate', { DATABASE_URL: BASE.DATABASE_URL }), '', 'migrate needs only the database');
});

test('the sandbox RPC is loopback on the host and host.docker.internal in a container', () => {
  assert.equal(sandboxRpcUrl(false), 'http://127.0.0.1:3030');
  assert.equal(sandboxRpcUrl(true), 'http://host.docker.internal:3030');
});

test('NEAR_NETWORK=sandbox selects the local near chain outside production', () => {
  const oneNear = '1000000000000000000000000';
  const operatorKey = path.resolve(REPO_ROOT, 'infra/compose/.local/near/keys/operator.json');
  const env = {
    DATABASE_URL: BASE.DATABASE_URL, SESSION_SECRET: BASE.SESSION_SECRET, INTAKE_RECIPIENT: 'treasury.test.near', NEAR_NETWORK: 'sandbox',
  };
  const config = loadConfig('api', env);
  assert.equal(config.intake.network, 'sandbox');
  assert.equal(config.intake.priceYocto, oneNear);
  assert.equal(config.intake.contractId, 'registry.test.near');
  assert.equal(config.chain.adapter, 'near');
  assert.deepEqual(config.chain.rpcUrls, [sandboxRpcUrl(fs.existsSync('/.dockerenv'))]);
  assert.equal(config.chain.operatorKeyFile, operatorKey);
  assert.equal(loadConfig('api', { ...env, NETWORK: 'mainnet' }).intake.network, 'sandbox', 'NEAR_NETWORK wins over NETWORK');

  const explicit = loadConfig('worker', {
    ...env, CHAIN_ADAPTER: 'mock', PRICE_YOCTO: '2', CONTRACT_ID: 'other.test.near',
    RPC_URLS: 'http://127.0.0.1:9', OPERATOR_KEY_FILE: '/tmp/operator.json',
  });
  assert.equal(explicit.chain.adapter, 'near', 'sandbox forces near even when CHAIN_ADAPTER=mock');
  assert.equal(explicit.intake.network, 'sandbox');
  assert.equal(explicit.intake.priceYocto, '2');
  assert.equal(explicit.intake.contractId, 'other.test.near');
  assert.deepEqual(explicit.chain.rpcUrls, ['http://127.0.0.1:9']);
  assert.equal(explicit.chain.operatorKeyFile, path.resolve('/tmp/operator.json'));

  const worker = loadConfig('worker', { DATABASE_URL: BASE.DATABASE_URL, NEAR_NETWORK: 'sandbox' });
  assert.equal(worker.intake.contractId, 'registry.test.near');
  assert.equal(worker.chain.adapter, 'near');
  assert.equal(worker.chain.operatorKeyFile, operatorKey);

  const testnet = loadConfig('api', { ...BASE, NEAR_NETWORK: 'testnet' });
  assert.equal(testnet.intake.network, 'testnet');
  assert.equal(testnet.intake.priceYocto, oneNear);
  assert.equal(testnet.chain.adapter, 'mock');
  assert.equal(testnet.intake.contractId, 'registry.testnet');
  assert.equal(testnet.chain.operatorKeyFile, null);
  assert.deepEqual(testnet.chain.rpcUrls, []);
});

test('the guard account-age signal is off unless GUARD_ACCOUNT_AGE=nearblocks; hygiene has defaults', async () => {
  const { accountAgeFromConfig } = await import('@omniswarm/guard/account-age');
  const off = loadConfig('api', BASE).guard;
  assert.deepEqual(off, { accountAge: 'off', nearblocksApiKey: null });
  assert.equal(accountAgeFromConfig({ provider: off.accountAge, network: 'testnet' }), undefined);
  const on = loadConfig('api', { ...BASE, GUARD_ACCOUNT_AGE: 'nearblocks', NEARBLOCKS_API_KEY: 'k' }).guard;
  assert.ok(accountAgeFromConfig({ provider: on.accountAge, network: 'testnet', apiKey: on.nearblocksApiKey ?? 'k' }), 'a source is built; nothing is fetched');
  assert.match(issue('api', { ...BASE, GUARD_ACCOUNT_AGE: 'indexer' }), /GUARD_ACCOUNT_AGE/);
  const { storage } = loadConfig('worker', { ...BASE });
  assert.deepEqual([storage.keepRuns, storage.orphanReportRetentionH], [20, 168]);
});
