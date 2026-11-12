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
const STACK = {
  OMNI_DOMAIN: 'omniswarm.example', OMNI_REPORTS_DOMAIN: 'reports.omniswarm.example', OMNI_ACME_EMAIL: 'ops@omniswarm.example',
  POSTGRES_PASSWORD: PASSWORD, SESSION_SECRET: SESSION, ADMIN_TOKEN: 'a'.repeat(40),
  CONTRACT_ID: 'review-registry.alice.testnet', INTAKE_RECIPIENT: 'omniswarm.alice.testnet', RPC_URLS: 'https://rpc.testnet.near.org',
  PRICE_YOCTO: '1000000000000000000000000', HOSTED_PRESET: 'hosted',
  NEXT_PUBLIC_CONTRACT_ID: 'review-registry.alice.testnet', NEXT_PUBLIC_INTAKE_RECIPIENT: 'omniswarm.alice.testnet', NEXT_PUBLIC_RPC_URL: 'https://rpc.testnet.near.org',
};
const WORKER = {
  DATABASE_URL: `postgres://omniswarm:${PASSWORD}@127.0.0.1:5432/omniswarm`, REPORTS_BASE_URL: 'https://reports.omniswarm.example',
  CONTRACT_ID: 'review-registry.alice.testnet', RPC_URLS: 'https://rpc.testnet.near.org', HOSTED_PRESET: 'hosted',
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
function ownerDir({ stack = {}, worker = {}, providers = '', key = { account_id: 'operator.alice.testnet', public_key: 'ed25519:pub', private_key: 'ed25519:priv' } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniswarm-secrets-'));
  fs.writeFileSync(path.join(dir, 'stack.env'), fill('stack.env', { ...STACK, ...stack }));
  fs.writeFileSync(path.join(dir, 'worker.env'), fill('worker.env', { ...WORKER, ...worker }));
  fs.writeFileSync(path.join(dir, 'providers.env'), fill('providers.env', {}) + providers);
  if (key) fs.writeFileSync(path.join(dir, 'operator-key.json'), JSON.stringify(key));
  fs.copyFileSync(new URL('../../engine/omniswarm.config.example.json', import.meta.url), path.join(dir, 'omniswarm.config.json'));
  return dir;
}

test('a consistent set passes and prints names with fingerprints, never values', () => {
  const { errors, lines } = checkSecrets(ownerDir());
  assert.deepEqual(errors, []);
  assert.ok(lines.includes(`stack.env: SESSION_SECRET ${fingerprint(SESSION)}`), lines.join('\n'));
  assert.ok(lines.includes('stack.env: GITHUB_TOKEN (empty)'));
  assert.ok(lines.some((l) => l.startsWith('operator-key.json: file sha256:')));
  assert.ok(lines.includes('stack.env: NEXT_PUBLIC_DONATION_ACCOUNT (empty)'), 'donations are optional');
  const printed = lines.join('\n');
  for (const secret of [PASSWORD, SESSION, 'ed25519:priv']) assert.ok(!printed.includes(secret), `printed ${secret}`);
});

test('a provider key left in providers.env is refused by name and fingerprint, never by value', () => {
  const { errors, lines } = checkSecrets(ownerDir({ providers: 'NEARAI_API_KEY=leftover-key-value\n' }));
  assert.ok(errors.includes('providers.env: NEARAI_API_KEY is set; OmniSwarm holds no operator provider key (users bring their own NEAR AI key), so remove it'), errors.join('\n'));
  assert.ok(lines.includes(`providers.env: NEARAI_API_KEY ${fingerprint('leftover-key-value')}`), lines.join('\n'));
  assert.ok(!lines.join('\n').includes('leftover-key-value'));
});

test('NEXT_PUBLIC_CONTRACT_ID must equal CONTRACT_ID, and the worker must agree with the stack', () => {
  const { errors } = checkSecrets(ownerDir({ stack: { NEXT_PUBLIC_CONTRACT_ID: 'review-registry.bob.testnet' }, worker: { HOSTED_PRESET: 'demo' } }));
  assert.ok(errors.some((e) => e.startsWith('stack.env NEXT_PUBLIC_CONTRACT_ID must equal stack.env CONTRACT_ID')), errors.join('\n'));
  assert.ok(errors.includes('worker.env HOSTED_PRESET must equal stack.env HOSTED_PRESET'), errors.join('\n'));
});

test('the optional donation recipient must be on the stack\'s network', () => {
  assert.deepEqual(checkSecrets(ownerDir({ stack: { NEXT_PUBLIC_DONATION_ACCOUNT: 'support.alice.testnet' } })).errors, []);
  const { errors } = checkSecrets(ownerDir({ stack: { NEXT_PUBLIC_DONATION_ACCOUNT: 'support.near' } }));
  assert.ok(errors.includes('stack.env NEXT_PUBLIC_DONATION_ACCOUNT support.near is not a testnet account but NETWORK=testnet'), errors.join('\n'));
});

test('the worker DATABASE_URL must carry POSTGRES_PASSWORD and point at loopback', () => {
  const { errors } = checkSecrets(ownerDir({ worker: { DATABASE_URL: 'postgres://omniswarm:other@db.example:5432/omniswarm' } }));
  assert.ok(errors.includes('worker.env DATABASE_URL password must equal stack.env POSTGRES_PASSWORD'), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('127.0.0.1:5432')), errors.join('\n'));
});

test('placeholder contract ids, short secrets, empty required values and a missing key file are errors', () => {
  const placeholder = 'review-registry.mock';
  const { errors } = checkSecrets(ownerDir({
    stack: { CONTRACT_ID: placeholder, NEXT_PUBLIC_CONTRACT_ID: placeholder, SESSION_SECRET: 'short', OMNI_ACME_EMAIL: '' },
    worker: { CONTRACT_ID: placeholder }, key: null,
  }));
  assert.ok(errors.some((e) => e.includes(`CONTRACT_ID ${placeholder} is a placeholder`)), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('stack.env: SESSION_SECRET is 5 characters')), errors.join('\n'));
  assert.ok(errors.includes('stack.env: OMNI_ACME_EMAIL is empty'), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('operator-key.json is missing')), errors.join('\n'));
});

test('secrets.sh --dry-run plans a 0600 root install per file over ssh and prints no value', () => {
  const dir = ownerDir();
  const script = fileURLToPath(new URL('../deploy/secrets.sh', import.meta.url));
  const run = spawnSync('bash', [script, '--dry-run', 'secrets-host.invalid', '--from', dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const name of ['stack.env', 'worker.env', 'providers.env', 'operator-key.json', 'omniswarm.config.json']) {
    assert.ok(run.stdout.includes(`+ ssh -o BatchMode=yes secrets-host.invalid < ${dir}/${name} <<remote\n`), `no ssh install for ${name}`);
    assert.ok(run.stdout.includes(`chmod 0600 /etc/omniswarm/.${name}.new && mv -f /etc/omniswarm/.${name}.new /etc/omniswarm/${name}`), `no 0600 rename for ${name}`);
    assert.match(run.stdout, new RegExp(`would install /etc/omniswarm/${name.replace('.', '\\.')} \\(sha256:[0-9a-f]{12}\\)`));
  }
  assert.match(run.stdout, /docker inspect/);
  for (const secret of [PASSWORD, SESSION, 'ed25519:priv']) assert.ok(!run.stdout.includes(secret), `printed ${secret}`);
  const bad = ownerDir({ stack: { NEXT_PUBLIC_CONTRACT_ID: 'review-registry.bob.testnet' } });
  const refused = spawnSync('bash', [script, '--dry-run', 'secrets-host.invalid', '--from', bad], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.doesNotMatch(refused.stdout, /\+ ssh/);
});

test('an operator key file of the contract account, or a preset the config lacks, is an error', () => {
  const { errors } = checkSecrets(ownerDir({
    stack: { HOSTED_PRESET: 'nope' }, worker: { HOSTED_PRESET: 'nope' },
    key: { account_id: 'review-registry.alice.testnet', public_key: 'ed25519:p', private_key: 'ed25519:k' },
  }));
  assert.ok(errors.some((e) => e.startsWith('operator-key.json belongs to the contract account')), errors.join('\n'));
  assert.ok(errors.includes('omniswarm.config.json has no preset "nope" (stack.env HOSTED_PRESET)'), errors.join('\n'));
});
