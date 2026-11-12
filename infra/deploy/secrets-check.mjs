// Checks the owner's filled env files before infra/deploy/secrets.sh installs them
// (W12-10): every example variable is present, required ones are set, the values that
// must agree across files agree, and no placeholder contract id is left. Prints each
// variable's name with a sha256 fingerprint (first 12 hex), never a value.
//
//   node infra/deploy/secrets-check.mjs <dir>      exit 1 on an error
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from '../check/env-contract.mjs';

const INFRA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILES = ['stack.env', 'worker.env', 'providers.env', 'ops.env'];
export const OPTIONAL = new Set(['ops.env', 'operator-key.json', 'omniswarm.config.json']);
// May stay empty: unauthenticated GitHub API, no alert hook, no heartbeat.
// ALLOWED_PRESETS empty = HOSTED_PRESET only; ACCOUNT_KEYS_SECRET is needed only with an account- preset (checked below).
const MAY_BE_EMPTY = new Set(['GITHUB_TOKEN', 'OMNI_ALERT_WEBHOOK_URL', 'OMNI_HEARTBEAT_URL', 'ALLOWED_PRESETS', 'ACCOUNT_KEYS_SECRET']);
const MIN_LENGTH = { SESSION_SECRET: 32, ADMIN_TOKEN: 32, POSTGRES_PASSWORD: 16, ACCOUNT_KEYS_SECRET: 32 };
const PLACEHOLDER_CONTRACT = /(\.mock$|^review-registry\.owner\.testnet$|example)/;

export const fingerprint = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)}`;

function example(file) {
  return parseEnv(fs.readFileSync(path.join(INFRA, 'env', `${file}.example`), 'utf8'));
}

// An empty value in an example means "the owner sets this" (stack.env.example header).
function checkPresence(file, vars, errors, warnings) {
  const want = example(file);
  for (const [name, exampleValue] of want) {
    if (!vars.has(name)) errors.push(`${file}: ${name} is missing (see infra/env/${file}.example)`);
    else if (vars.get(name) === '' && exampleValue === '' && !MAY_BE_EMPTY.has(name)) {
      // A scripted/demo preset needs no provider key, so an empty one only warns.
      (file === 'providers.env' ? warnings : errors).push(`${file}: ${name} is empty`);
    }
  }
  for (const name of vars.keys()) if (!want.has(name)) warnings.push(`${file}: ${name} is not in infra/env/${file}.example (ignored by the stack)`);
  for (const [name, min] of Object.entries(MIN_LENGTH)) {
    const value = vars.get(name);
    if (value && value.length < min) errors.push(`${file}: ${name} is ${value.length} characters; use at least ${min} (openssl rand -hex ${min / 2})`);
  }
}

function same(errors, a, b, why) {
  if (a.value !== b.value) errors.push(`${a.label} must equal ${b.label}${why ? ` (${why})` : ''}`);
}

function checkConsistency(stack, worker, errors, warnings) {
  const s = (name) => ({ label: `stack.env ${name}`, value: stack.get(name) ?? '' });
  const w = (name) => ({ label: `worker.env ${name}`, value: worker.get(name) ?? '' });
  same(errors, s('NEXT_PUBLIC_CONTRACT_ID'), s('CONTRACT_ID'), 'otherwise every payment stops at CONTRACT_MISMATCH');
  same(errors, s('NEXT_PUBLIC_INTAKE_RECIPIENT'), s('INTAKE_RECIPIENT'), 'the wallet signs for this recipient');
  same(errors, s('NEXT_PUBLIC_NETWORK'), s('NETWORK'));
  for (const name of ['CONTRACT_ID', 'NETWORK', 'RPC_URLS', 'HOSTED_PRESET', 'ALLOWED_PRESETS', 'ACCOUNT_KEYS_SECRET']) same(errors, w(name), s(name));
  // An account- preset decrypts accounts' own provider keys in the API and the worker.
  if ((stack.get('ALLOWED_PRESETS') || '').split(',').some((preset) => preset.trim().startsWith('account-')) && !stack.get('ACCOUNT_KEYS_SECRET')) {
    errors.push('stack.env ACCOUNT_KEYS_SECRET is empty but ALLOWED_PRESETS has an account- preset');
  }
  if (stack.get('ACCOUNT_KEYS_SECRET') && stack.get('ACCOUNT_KEYS_SECRET') === stack.get('SESSION_SECRET')) {
    errors.push('stack.env ACCOUNT_KEYS_SECRET must differ from SESSION_SECRET (the workers receive it)');
  }
  const contract = stack.get('CONTRACT_ID') || '';
  const network = stack.get('NETWORK') || 'testnet';
  if (PLACEHOLDER_CONTRACT.test(contract)) errors.push(`stack.env CONTRACT_ID ${contract} is a placeholder; use the id deploy-testnet.sh created`);
  if (contract && network === 'testnet' && !contract.endsWith('.testnet')) errors.push(`stack.env CONTRACT_ID ${contract} is not a .testnet account but NETWORK=testnet`);
  if (contract && network === 'mainnet' && contract.endsWith('.testnet')) errors.push(`stack.env CONTRACT_ID ${contract} is a .testnet account but NETWORK=mainnet`);
  if (contract === 'review-registry.omniswarm.testnet') warnings.push('CONTRACT_ID equals the web app\'s built-in example; make sure your account owns it');
  checkDatabaseUrl(worker.get('DATABASE_URL') || '', stack.get('POSTGRES_PASSWORD') || '', errors);
  const reports = stack.get('OMNI_REPORTS_DOMAIN');
  if (reports && worker.get('REPORTS_BASE_URL') !== `https://${reports}`) errors.push(`worker.env REPORTS_BASE_URL must be https://${reports} (stack.env OMNI_REPORTS_DOMAIN)`);
}

function checkDatabaseUrl(value, password, errors) {
  let url;
  try { url = new URL(value); } catch { errors.push('worker.env DATABASE_URL is not a URL'); return; }
  if (url.hostname !== '127.0.0.1' || url.port !== '5432') errors.push('worker.env DATABASE_URL must point at 127.0.0.1:5432 (Postgres is loopback-only on the host)');
  if (url.username !== 'omniswarm' || url.pathname !== '/omniswarm') errors.push('worker.env DATABASE_URL must use user omniswarm and database omniswarm');
  if (decodeURIComponent(url.password) !== password) errors.push('worker.env DATABASE_URL password must equal stack.env POSTGRES_PASSWORD');
}

function checkJson(dir, stack, errors, lines) {
  const keyFile = path.join(dir, 'operator-key.json');
  if (fs.existsSync(keyFile)) {
    let key = null;
    try { key = JSON.parse(fs.readFileSync(keyFile, 'utf8')); } catch { errors.push('operator-key.json is not JSON'); }
    if (key) {
      if (!/^ed25519:/.test(key.private_key ?? key.secret_key ?? '')) errors.push('operator-key.json has no ed25519 private_key');
      if (!/^ed25519:/.test(key.public_key ?? '')) errors.push('operator-key.json has no ed25519 public_key');
      if (typeof key.account_id !== 'string') errors.push('operator-key.json has no account_id');
      else if (key.account_id === stack.get('CONTRACT_ID')) errors.push('operator-key.json belongs to the contract account; use the operator account\'s function-call key');
    }
  } else errors.push('operator-key.json is missing (deploy-testnet.sh step 5 writes it under ~/.near-credentials/testnet/)');
  const configFile = path.join(dir, 'omniswarm.config.json');
  if (fs.existsSync(configFile)) {
    let config = null;
    try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { errors.push('omniswarm.config.json is not JSON'); }
    const preset = stack.get('HOSTED_PRESET');
    if (config && preset && !config.presets?.[preset]) errors.push(`omniswarm.config.json has no preset "${preset}" (stack.env HOSTED_PRESET)`);
  }
  for (const name of ['operator-key.json', 'omniswarm.config.json']) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) lines.push(`${name}: file ${fingerprint(fs.readFileSync(file))}`);
  }
}

export function checkSecrets(dir) {
  const errors = [];
  const warnings = [];
  const lines = [];
  const files = {};
  for (const file of ENV_FILES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) {
      if (!OPTIONAL.has(file)) errors.push(`${file} is missing in ${dir}`);
      files[file] = new Map();
      continue;
    }
    try { files[file] = parseEnv(fs.readFileSync(full, 'utf8')); } catch (error) { errors.push(`${file}: ${error.message}`); files[file] = new Map(); continue; }
    checkPresence(file, files[file], errors, warnings);
    for (const [name, value] of files[file]) lines.push(`${file}: ${name} ${value === '' ? '(empty)' : fingerprint(value)}`);
  }
  if (!errors.some((e) => /^(stack|worker)\.env is missing/.test(e))) checkConsistency(files['stack.env'], files['worker.env'], errors, warnings);
  checkJson(dir, files['stack.env'], errors, lines);
  return { errors, warnings, lines };
}

function main([dir]) {
  if (!dir) { process.stderr.write('usage: secrets-check.mjs <dir with the filled env files>\n'); return 64; }
  const { errors, warnings, lines } = checkSecrets(dir);
  for (const line of lines) console.log(`  ${line}`);
  for (const w of warnings) console.log(`  warn: ${w}`);
  for (const e of errors) console.log(`  error: ${e}`);
  console.log(`secrets check: ${errors.length ? 'FAILED' : 'ok'} (${errors.length} errors, ${warnings.length} warnings)`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
