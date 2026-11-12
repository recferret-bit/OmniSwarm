import test from 'node:test';
import assert from 'node:assert/strict';
import { checkContract, composeRefs, parseEnv, requiredUnset, unitEnv } from './env-contract.mjs';

function input(overrides = {}) {
  const base = {
    stack: parseEnv('POSTGRES_PASSWORD=\nSESSION_SECRET=\nNETWORK=testnet\nOMNI_DOMAIN=\n'),
    dev: parseEnv('OMNI_DOMAIN=omniswarm.localhost\nOMNI_HTTP_PORT=18480\n'),
    worker: parseEnv('DATABASE_URL=\nWORKER_CONCURRENCY=1\n'),
    providers: parseEnv(''),
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
  const composeJson = { services: { api: { environment: { DATABASE_URL: 'u', SESSION_SECRET: 's', NETWORK: 't', NEARAI_API_KEY: 'k' } } } };
  const { errors } = checkContract(input({ composeJson }));
  assert.ok(errors.includes('compose service api receives provider variable NEARAI_API_KEY; keys belong to the worker only'), errors.join('\n'));
});

test('REPORTS_BASE_URL in the api is app config, not a provider variable', () => {
  const composeJson = { services: { api: { environment: { DATABASE_URL: 'u', SESSION_SECRET: 's', NETWORK: 't', REPORTS_BASE_URL: 'https://r' } } } };
  const { errors } = checkContract(input({ composeJson, apiExample: parseEnv('DATABASE_URL=x\nSESSION_SECRET=x\nNETWORK=testnet\nWORKER_CONCURRENCY=1\nREPORTS_BASE_URL=\n') }));
  assert.ok(!errors.some((e) => e.includes('provider variable')), errors.join('\n'));
  const leaked = checkContract(input({ composeJson: { services: { api: { environment: { EXAMPLE_BASE_URL: 'x' } } } }, providers: parseEnv('EXAMPLE_API_KEY=\nEXAMPLE_BASE_URL=\n') })).errors;
  assert.ok(leaked.includes('compose service api receives provider variable EXAMPLE_BASE_URL; keys belong to the worker only'), leaked.join('\n'));
});

test('a non-provider name in providers.env.example is an error', () => {
  const { errors } = checkContract(input({ providers: parseEnv('NEARAI_API_KEY=\nDATABASE_URL=\n') }));
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

test('a dev-only value must be read by compose.dev.yml or by the local worker command', () => {
  const dev = parseEnv('OMNI_DOMAIN=omniswarm.localhost\nOMNI_HTTP_PORT=18480\nENGINE_RUNNER=mock\n');
  const unread = checkContract(input({ dev })).errors;
  assert.ok(unread.includes('ENGINE_RUNNER (dev.env.example) is neither a stack variable nor read by compose.dev.yml or compose/local.sh'), unread.join('\n'));
  assert.deepEqual(checkContract(input({ dev, devScripts: 'ENGINE_RUNNER=$(omni_env_value ENGINE_RUNNER)' })).errors, []);
});

test('requiredUnset lists the :? variables the owner must fill', () => {
  const i = input();
  assert.deepEqual(requiredUnset(i.stack, i.baseRefs), ['OMNI_DOMAIN', 'POSTGRES_PASSWORD', 'SESSION_SECRET']);
});

test('the donation build args are optional: declared empty, never required by compose', async () => {
  const fs = await import('node:fs');
  const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const stack = parseEnv(read('env/stack.env.example'));
  const refs = composeRefs(read('compose/compose.yml'));
  for (const name of ['NEXT_PUBLIC_DONATION_ACCOUNT', 'NEXT_PUBLIC_DONATION_USDC_CONTRACT']) {
    assert.equal(stack.get(name), '', `${name} must be declared empty in stack.env.example`);
    assert.equal(refs.get(name), false, `${name} must be read by compose.yml without :?`);
  }
  assert.ok(!requiredUnset(stack, refs).some((name) => name.includes('DONATION')));
  assert.equal(parseEnv(read('env/providers.env.example')).size, 0, 'providers.env.example declares no operator provider key');
});
