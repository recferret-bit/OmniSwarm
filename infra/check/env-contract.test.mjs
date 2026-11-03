import test from 'node:test';
import assert from 'node:assert/strict';
import { checkContract, composeRefs, parseEnv, requiredUnset, unitEnv } from './env-contract.mjs';

function input(overrides = {}) {
  const base = {
    stack: parseEnv('POSTGRES_PASSWORD=\nSESSION_SECRET=\nNETWORK=testnet\nOMNI_DOMAIN=\n'),
    dev: parseEnv('OMNI_DOMAIN=omniswarm.localhost\nOMNI_HTTP_PORT=18480\n'),
    worker: parseEnv('DATABASE_URL=\nWORKER_CONCURRENCY=1\n'),
    providers: parseEnv('ZAI_API_KEY=\nOPENROUTER_API_KEY=\n'),
    apiExample: parseEnv('DATABASE_URL=x\nSESSION_SECRET=x\nNETWORK=testnet\nWORKER_CONCURRENCY=1\n'),
    baseRefs: composeRefs('${POSTGRES_PASSWORD:?m} ${SESSION_SECRET:?m} ${NETWORK:?m} ${OMNI_DOMAIN:?m} ${OMNI_RELEASE:?m}'),
    devRefs: composeRefs('${OMNI_HTTP_PORT:?m} ${OMNI_DOMAIN}'),
    workerUnitEnv: unitEnv('Environment=WORKER_ID=%i\nEnvironment=HOME=/var/lib/x\n'),
    composeJson: { services: { api: { environment: { DATABASE_URL: 'u', SESSION_SECRET: 's', NETWORK: 'testnet' } } } },
  };
  return { ...base, ...overrides };
}

test('parse helpers', () => {
  assert.deepEqual([...composeRefs('${A:?x} ${B:-y} $${NOT} ${C}\n  # a comment about ${D:?}\n')], [['A', true], ['B', false], ['C', false]]);
  assert.deepEqual([...unitEnv('Environment=A=1\nEnvironmentFile=/x\nEnvironment=B=%i\n')], ['A', 'B']);
  assert.throws(() => parseEnv('no equals sign'), /not KEY=value/);
});

test('a consistent contract has no errors', () => {
  const { errors, warnings } = checkContract(input());
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, ['infra sets WORKER_ID for the api/worker, but apps/api/.env.example does not declare it']);
});

test('a compose variable missing from the example is an error', () => {
  const { errors } = checkContract(input({ baseRefs: composeRefs('${POSTGRES_PASSWORD:?m} ${SESSION_SECRET:?m} ${NETWORK:?m} ${OMNI_DOMAIN:?m} ${UNDECLARED:?m}') }));
  assert.ok(errors.includes('compose reads UNDECLARED, not declared in infra/env/stack.env.example'), errors.join('\n'));
});

test('a declared but unused stack variable is an error (dead config)', () => {
  const { errors } = checkContract(input({ stack: parseEnv('POSTGRES_PASSWORD=\nSESSION_SECRET=\nNETWORK=testnet\nOMNI_DOMAIN=\nLEFTOVER=1\n') }));
  assert.ok(errors.some((e) => e.startsWith('LEFTOVER (stack.env.example) is declared but no compose file reads it')), errors.join('\n'));
});

test('a secret with a value in an example is an error (the skeleton defaulted SESSION_SECRET)', () => {
  const { errors } = checkContract(input({ stack: parseEnv('POSTGRES_PASSWORD=omniswarm\nSESSION_SECRET=dev-session-secret\nNETWORK=testnet\nOMNI_DOMAIN=\n') }));
  assert.ok(errors.includes('POSTGRES_PASSWORD (stack.env.example) has a value; secrets in examples must be empty'));
  assert.ok(errors.includes('SESSION_SECRET (stack.env.example) has a value; secrets in examples must be empty'));
});

test('an api variable nobody delivers is an error (the skeleton never passed ADMIN_TOKEN)', () => {
  const { errors } = checkContract(input({ apiExample: parseEnv('DATABASE_URL=x\nADMIN_TOKEN=\n') }));
  assert.ok(errors.includes('apps/api/.env.example declares ADMIN_TOKEN; no infra env file or compose service delivers it'), errors.join('\n'));
});

test('a provider key in any compose service is an error', () => {
  const composeJson = { services: { api: { environment: { DATABASE_URL: 'u', SESSION_SECRET: 's', NETWORK: 't', OPENROUTER_API_KEY: 'k' } } } };
  const { errors } = checkContract(input({ composeJson }));
  assert.ok(errors.includes('compose service api receives provider variable OPENROUTER_API_KEY; keys belong to the worker only'), errors.join('\n'));
});

test('a non-provider name in providers.env.example is an error', () => {
  const { errors } = checkContract(input({ providers: parseEnv('ZAI_API_KEY=\nDATABASE_URL=\n') }));
  assert.ok(errors.includes('DATABASE_URL (providers.env.example) is not a provider variable (<PROVIDER>_API_KEY or _BASE_URL)'));
});

test('ops.env.example: host-timer settings are OMNI_*, read by a deploy script, and URLs stay empty', () => {
  const hostScripts = 'omni_fetch OMNI_HEARTBEAT_URL\nAFTER="${OMNI_HEALTH_RESTART_AFTER:-2}"\n';
  assert.deepEqual(checkContract(input({ ops: parseEnv('OMNI_HEARTBEAT_URL=\nOMNI_HEALTH_RESTART_AFTER=2\n'), hostScripts })).errors, []);
  const { errors } = checkContract(input({
    ops: parseEnv('OMNI_HEARTBEAT_URL=https://hc-ping.com/real-uuid\nOMNI_UNUSED=1\nALERT_TO=x\nOMNI_DOMAIN=\n'), hostScripts,
  }));
  assert.ok(errors.includes('OMNI_HEARTBEAT_URL (ops.env.example) has a value; URLs in examples must be empty'), errors.join('\n'));
  assert.ok(errors.includes('OMNI_UNUSED (ops.env.example) is declared but no infra/deploy script reads it'), errors.join('\n'));
  assert.ok(errors.includes('ALERT_TO (ops.env.example) is not an OMNI_* host setting'), errors.join('\n'));
  assert.ok(errors.includes('OMNI_DOMAIN (ops.env.example) is also declared in stack.env.example'), errors.join('\n'));
});

test('requiredUnset lists the :? variables the owner must fill', () => {
  const i = input();
  assert.deepEqual(requiredUnset(i.stack, i.baseRefs), ['OMNI_DOMAIN', 'POSTGRES_PASSWORD', 'SESSION_SECRET']);
});
