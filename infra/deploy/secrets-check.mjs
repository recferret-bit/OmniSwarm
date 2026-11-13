// Checks the owner's filled env files before infra/deploy/secrets.sh installs them
// (W12-10): every example variable is present, required ones are set, the values that
// must agree across files agree, and the donation recipient is not a testnet account. Prints each
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
export const OPTIONAL = new Set(['ops.env', 'omniswarm.config.json']);
// May stay empty: unauthenticated GitHub API, no alert hook, no heartbeat.
// ACCOUNT_KEYS_SECRET and RPC_URLS are required in production (an empty one is an error).
// The donation section is optional: no recipient hides it, no contract override uses mainnet USDC.
const MAY_BE_EMPTY = new Set([
  'GITHUB_TOKEN', 'OMNI_ALERT_WEBHOOK_URL', 'OMNI_HEARTBEAT_URL',
  'NEXT_PUBLIC_DONATION_ACCOUNT', 'NEXT_PUBLIC_DONATION_USDC_CONTRACT',
]);
const MIN_LENGTH = { SESSION_SECRET: 32, POSTGRES_PASSWORD: 16, ACCOUNT_KEYS_SECRET: 32 };

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
  for (const name of vars.keys()) {
    if (want.has(name)) continue;
    // The worker unit loads providers.env, so a key left there could pay for a `hosted` preset job (OD-26).
    if (file === 'providers.env') errors.push(`providers.env: ${name} is set; OmniSwarm holds no operator provider key (users bring their own NEAR AI key), so remove it`);
    else warnings.push(`${file}: ${name} is not in infra/env/${file}.example (ignored by the stack)`);
  }
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
  same(errors, w('ACCOUNT_KEYS_SECRET'), s('ACCOUNT_KEYS_SECRET'), 'the worker decrypts the keys the API sealed');
  // Production refuses KEY_VERIFIER=mock; rpc needs RPC_URLS (empty is caught as a required value above).
  if ((stack.get('KEY_VERIFIER') || 'rpc') !== 'rpc') errors.push('stack.env KEY_VERIFIER must be rpc (production refuses mock)');
  for (const url of (stack.get('RPC_URLS') || '').split(',').map((u) => u.trim()).filter(Boolean)) {
    if (!/^https:\/\//.test(url)) errors.push('stack.env RPC_URLS entries must be https URLs');
    else if (/testnet/i.test(url)) errors.push('stack.env RPC_URLS points at a testnet RPC; OmniSwarm is mainnet only');
  }
  if (stack.get('ACCOUNT_KEYS_SECRET') && stack.get('ACCOUNT_KEYS_SECRET') === stack.get('SESSION_SECRET')) {
    errors.push('stack.env ACCOUNT_KEYS_SECRET must differ from SESSION_SECRET (the workers receive it)');
  }
  // Mainnet only: donations are an ft_transfer of mainnet USDC, so a .testnet recipient never receives them.
  const donation = stack.get('NEXT_PUBLIC_DONATION_ACCOUNT') || '';
  if (donation.endsWith('.testnet')) errors.push(`stack.env NEXT_PUBLIC_DONATION_ACCOUNT ${donation} is a .testnet account; OmniSwarm is mainnet only`);
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

function checkJson(dir, errors, lines) {
  const file = path.join(dir, 'omniswarm.config.json');
  if (!fs.existsSync(file)) return;
  try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch { errors.push('omniswarm.config.json is not JSON'); }
  lines.push(`omniswarm.config.json: file ${fingerprint(fs.readFileSync(file))}`);
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
  checkJson(dir, errors, lines);
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
