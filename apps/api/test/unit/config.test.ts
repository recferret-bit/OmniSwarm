import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../../src/config/load.ts';
import { createEngine, createGitHub, createKeyVerifier } from '../../src/container.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';

const BASE = { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db', SESSION_SECRET: 's'.repeat(40) };
const PROD = {
  ...BASE, NODE_ENV: 'production', RPC_URLS: 'https://rpc.mainnet.fastnear.com', REPORTS_BASE_URL: 'https://reports.example',
  ACCOUNT_KEYS_SECRET: 'a'.repeat(40),
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
});

test('production refuses test adapters and insecure cookies, and names no chain setting', () => {
  assert.equal(issue('api', PROD), '');
  assert.equal(issue('worker', PROD), '');
  assert.match(issue('api', { ...PROD, KEY_VERIFIER: 'mock' }), /KEY_VERIFIER must be "rpc"/);
  assert.equal(loadConfig('api', PROD).keys.verifier, 'rpc', 'production defaults to the real verifier');
  assert.equal(loadConfig('api', BASE).keys.verifier, 'mock', 'outside production the default is the mock');
  assert.equal(loadConfig('worker', PROD).engine.runner, 'cli');
  assert.match(issue('api', { ...PROD, RPC_URLS: undefined }), /RPC_URLS is required for the rpc key verifier/);
  assert.equal(issue('worker', { ...PROD, RPC_URLS: undefined }), '', 'only sign-in (the API) reads access keys');
  assert.match(issue('api', { ...PROD, GITHUB_ADAPTER: 'recorded' }), /GITHUB_ADAPTER/);
  assert.match(issue('worker', { ...PROD, ENGINE_RUNNER: 'mock' }), /ENGINE_RUNNER/);
  assert.match(issue('worker', { ...PROD, REPORTS_BASE_URL: undefined }), /REPORTS_BASE_URL/);
  assert.match(issue('api', { ...PROD, REPORTS_BASE_URL: 'http://reports.example' }), /REPORTS_BASE_URL must be https in production/);
  assert.equal(loadConfig('worker', { ...BASE, REPORTS_BASE_URL: 'http://reports.localhost:18480' }).storage.reportsBaseUrl, 'http://reports.localhost:18480');
  assert.match(issue('api', { ...PROD, COOKIE_SECURE: '0' }), /COOKIE_SECURE/);
  assert.equal(loadConfig('api', PROD).http.cookieSecure, true);
  // Every review runs on an account's own key, so the sealing secret is always required in production.
  for (const role of ['api', 'worker'] as const) assert.match(issue(role, { ...PROD, ACCOUNT_KEYS_SECRET: undefined }), /ACCOUNT_KEYS_SECRET is required in production/);
  const messages = ['api', 'worker'].map((role) => issue(role as 'api', { ...PROD, KEY_VERIFIER: 'mock', GITHUB_ADAPTER: 'recorded', COOKIE_SECURE: '0', ACCOUNT_KEYS_SECRET: undefined })).join(' ');
  assert.doesNotMatch(messages, /testnet|sandbox/i);
});

test('removed chain settings are ignored, not read', () => {
  const stale = loadConfig('api', {
    ...BASE, NETWORK: 'testnet', CONTRACT_ID: 'registry.testnet', PRICE_YOCTO: '1', OPERATOR_KEY_FILE: '/x', CHAIN_ADAPTER: 'near', REVIEW_SETTINGS_FILE: '/y', ADMIN_TOKEN: 't'.repeat(40),
  } as NodeJS.ProcessEnv) as unknown as Record<string, Record<string, unknown> | unknown>;
  for (const key of ['chain', 'admin', 'guard', 'reviewSettingsFile']) assert.equal(key in stale, false, key);
  assert.deepEqual(Object.keys(stale.intake as object).sort(), ['allowlist', 'denylist', 'loginRecipient', 'maxQueue', 'requestsPerDay']);
});

test('the NEP-413 sign-in recipient defaults to omniswarm.near and INTAKE_RECIPIENT overrides it', () => {
  assert.equal(loadConfig('api', BASE).intake.loginRecipient, 'omniswarm.near');
  assert.equal(loadConfig('api', { ...BASE, INTAKE_RECIPIENT: 'omniswarm.example.near' }).intake.loginRecipient, 'omniswarm.example.near');
});

test('the factories refuse test adapters in production even if config were bypassed', async () => {
  const config = loadConfig('api', BASE);
  const prod = { ...config, env: 'production' as const };
  await assert.rejects(createKeyVerifier(prod), /test adapter/);
  await assert.rejects(createGitHub(prod), /test adapter/);
  await assert.rejects(createEngine({ ...prod, engine: { ...prod.engine, runner: 'mock' } }), /test adapter/);
});

test('trustProxy parses; migrate needs only the database', () => {
  assert.equal(loadConfig('api', { ...BASE, TRUST_PROXY: '1' }).http.trustProxy, 1);
  assert.deepEqual(loadConfig('api', { ...BASE, TRUST_PROXY: '127.0.0.1,10.0.0.0/8' }).http.trustProxy, ['127.0.0.1', '10.0.0.0/8']);
  assert.equal(loadConfig('api', BASE).http.trustProxy, false);
  assert.equal(issue('migrate', { DATABASE_URL: BASE.DATABASE_URL }), '', 'migrate needs only the database');
});

test('hygiene has defaults; outside production the session secret seals account keys, in production only ACCOUNT_KEYS_SECRET', () => {
  assert.equal(loadConfig('worker', BASE).storage.keepRuns, 20);
  assert.equal(loadConfig('api', BASE as NodeJS.ProcessEnv).accountKeysSecret, BASE.SESSION_SECRET);
  assert.equal(loadConfig('api', PROD as NodeJS.ProcessEnv).accountKeysSecret, PROD.ACCOUNT_KEYS_SECRET);
  // A leftover PROVIDER_SECRETS_FILE from an older deployment is ignored, not read.
  const stale = loadConfig('api', { ...BASE, PROVIDER_SECRETS_FILE: '/srv/omni/providers.json' } as NodeJS.ProcessEnv) as unknown as Record<string, unknown>;
  assert.equal('providerSecretsFile' in stale, false);
});
