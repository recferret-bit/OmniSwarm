import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSecrets, fingerprint } from '../deploy/secrets-check.mjs';

const PASSWORD = 'pg-password-0123456789abcdef';
const SESSION = 's'.repeat(40);
const KEYS = 'k'.repeat(44);
const STACK = {
  OMNI_DOMAIN: 'omniswarm.example', OMNI_REPORTS_DOMAIN: 'reports.omniswarm.example', OMNI_ACME_EMAIL: 'ops@omniswarm.example',
  POSTGRES_PASSWORD: PASSWORD, SESSION_SECRET: SESSION,
  ACCOUNT_KEYS_SECRET: KEYS, RPC_URLS: 'https://rpc.mainnet.example/key-in-url',
};
const WORKER = {
  DATABASE_URL: `postgres://omniswarm:${PASSWORD}@127.0.0.1:5432/omniswarm`, REPORTS_BASE_URL: 'https://reports.omniswarm.example',
  ACCOUNT_KEYS_SECRET: KEYS,
};

// Every example variable, with the example's own value unless overridden.
function fill(file, values) {
  const example = fs.readFileSync(new URL(`../env/${file}.example`, import.meta.url), 'utf8');
  return example.split('\n').map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    return m && m[1] in values ? `${m[1]}=${values[m[1]]}` : line;
  }).join('\n');
}

// providers.env.example declares no variable (hosted reviews run on accounts' own keys); `providers` adds
// lines an older deploy may have left in the owner's copy.
function ownerDir({ stack = {}, worker = {}, providers = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniswarm-secrets-'));
  fs.writeFileSync(path.join(dir, 'stack.env'), fill('stack.env', { ...STACK, ...stack }));
  fs.writeFileSync(path.join(dir, 'worker.env'), fill('worker.env', { ...WORKER, ...worker }));
  fs.writeFileSync(path.join(dir, 'providers.env'), fill('providers.env', {}) + providers);
  fs.copyFileSync(new URL('../../engine/omniswarm.config.example.json', import.meta.url), path.join(dir, 'omniswarm.config.json'));
  return dir;
}

test('a consistent set passes and prints names with fingerprints, never values', () => {
  const { errors, lines } = checkSecrets(ownerDir());
  assert.deepEqual(errors, []);
  assert.ok(lines.includes(`stack.env: SESSION_SECRET ${fingerprint(SESSION)}`), lines.join('\n'));
  assert.ok(lines.includes('stack.env: GITHUB_TOKEN (empty)'));
  assert.ok(lines.some((l) => l.startsWith('omniswarm.config.json: file sha256:')));
  assert.ok(lines.includes('stack.env: NEXT_PUBLIC_DONATION_ACCOUNT (empty)'), 'donations are optional');
  const printed = lines.join('\n');
  for (const secret of [PASSWORD, SESSION, KEYS, 'key-in-url']) assert.ok(!printed.includes(secret), `printed ${secret}`);
});

test('a provider key left in providers.env is refused by name and fingerprint, never by value', () => {
  const { errors, lines } = checkSecrets(ownerDir({ providers: 'NEARAI_API_KEY=leftover-key-value\n' }));
  assert.ok(errors.includes('providers.env: NEARAI_API_KEY is set; OmniSwarm holds no operator provider key (users bring their own NEAR AI key), so remove it'), errors.join('\n'));
  assert.ok(lines.includes(`providers.env: NEARAI_API_KEY ${fingerprint('leftover-key-value')}`), lines.join('\n'));
  assert.ok(!lines.join('\n').includes('leftover-key-value'));
});

test('the worker must agree with the stack on ACCOUNT_KEYS_SECRET', () => {
  const { errors } = checkSecrets(ownerDir({ worker: { ACCOUNT_KEYS_SECRET: 'z'.repeat(44) } }));
  assert.ok(errors.includes('worker.env ACCOUNT_KEYS_SECRET must equal stack.env ACCOUNT_KEYS_SECRET (the worker decrypts the keys the API sealed)'), errors.join('\n'));
});

test('production needs RPC_URLS and ACCOUNT_KEYS_SECRET; the verifier must be rpc on mainnet https URLs', () => {
  const empty = checkSecrets(ownerDir({ stack: { RPC_URLS: '', ACCOUNT_KEYS_SECRET: '' }, worker: { ACCOUNT_KEYS_SECRET: '' } })).errors;
  assert.ok(empty.includes('stack.env: RPC_URLS is empty'), empty.join('\n'));
  assert.ok(empty.includes('stack.env: ACCOUNT_KEYS_SECRET is empty'), empty.join('\n'));
  assert.ok(empty.includes('worker.env: ACCOUNT_KEYS_SECRET is empty'), empty.join('\n'));
  assert.ok(checkSecrets(ownerDir({ stack: { KEY_VERIFIER: 'mock' } })).errors.includes('stack.env KEY_VERIFIER must be rpc (production refuses mock)'));
  assert.ok(checkSecrets(ownerDir({ stack: { RPC_URLS: 'http://rpc.example' } })).errors.includes('stack.env RPC_URLS entries must be https URLs'));
  assert.ok(checkSecrets(ownerDir({ stack: { RPC_URLS: 'https://rpc.testnet.near.org' } })).errors.some((e) => e.includes('testnet RPC')));
  assert.ok(checkSecrets(ownerDir({ stack: { ACCOUNT_KEYS_SECRET: SESSION }, worker: { ACCOUNT_KEYS_SECRET: SESSION } })).errors.some((e) => e.includes('must differ from SESSION_SECRET')));
});

test('the optional donation recipient must not be a testnet account (mainnet only)', () => {
  assert.deepEqual(checkSecrets(ownerDir({ stack: { NEXT_PUBLIC_DONATION_ACCOUNT: 'support.near' } })).errors, []);
  assert.deepEqual(checkSecrets(ownerDir({ stack: { NEXT_PUBLIC_DONATION_ACCOUNT: 'a'.repeat(64) } })).errors, []);
  const { errors } = checkSecrets(ownerDir({ stack: { NEXT_PUBLIC_DONATION_ACCOUNT: 'support.alice.testnet' } }));
  assert.ok(errors.includes('stack.env NEXT_PUBLIC_DONATION_ACCOUNT support.alice.testnet is a .testnet account; OmniSwarm is mainnet only'), errors.join('\n'));
});

test('the worker DATABASE_URL must carry POSTGRES_PASSWORD and point at loopback', () => {
  const { errors } = checkSecrets(ownerDir({ worker: { DATABASE_URL: 'postgres://omniswarm:other@db.example:5432/omniswarm' } }));
  assert.ok(errors.includes('worker.env DATABASE_URL password must equal stack.env POSTGRES_PASSWORD'), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('127.0.0.1:5432')), errors.join('\n'));
});

test('short secrets and empty required values are errors', () => {
  const { errors } = checkSecrets(ownerDir({ stack: { SESSION_SECRET: 'short', OMNI_ACME_EMAIL: '' } }));
  assert.ok(errors.some((e) => e.startsWith('stack.env: SESSION_SECRET is 5 characters')), errors.join('\n'));
  assert.ok(errors.includes('stack.env: OMNI_ACME_EMAIL is empty'), errors.join('\n'));
});

test('secrets.sh --dry-run plans a 0600 root install per file over ssh and prints no value', () => {
  const dir = ownerDir();
  const script = fileURLToPath(new URL('../deploy/secrets.sh', import.meta.url));
  const run = spawnSync('bash', [script, '--dry-run', 'secrets-host.invalid', '--from', dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const name of ['stack.env', 'worker.env', 'providers.env', 'omniswarm.config.json']) {
    assert.ok(run.stdout.includes(`+ ssh -o BatchMode=yes secrets-host.invalid < ${dir}/${name} <<remote\n`), `no ssh install for ${name}`);
    assert.ok(run.stdout.includes(`chmod 0600 /etc/omniswarm/.${name}.new && mv -f /etc/omniswarm/.${name}.new /etc/omniswarm/${name}`), `no 0600 rename for ${name}`);
    assert.match(run.stdout, new RegExp(`would install /etc/omniswarm/${name.replace('.', '\\.')} \\(sha256:[0-9a-f]{12}\\)`));
  }
  assert.match(run.stdout, /docker inspect/);
  for (const secret of [PASSWORD, SESSION, KEYS, 'key-in-url']) assert.ok(!run.stdout.includes(secret), `printed ${secret}`);
  const bad = ownerDir({ stack: { NEXT_PUBLIC_DONATION_ACCOUNT: 'support.bob.testnet' } });
  const refused = spawnSync('bash', [script, '--dry-run', 'secrets-host.invalid', '--from', bad], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.doesNotMatch(refused.stdout, /\+ ssh/);
});
