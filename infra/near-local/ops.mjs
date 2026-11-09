// `near:local view <method> [args-json]` and `near:local call <method> [args-json]`.
// The shell passes the verb first. Views are read-only on registry.test.near.
// Each call is signed with the seeded key that method allows. Secrets are not printed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Account, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { ACCOUNTS_FILE, KEYS_DIR, ROOT } from './lib/paths.mjs';
import { CONTRACT_ID, callView, provider, txHash } from './lib/rpc.mjs';

// refund and withdraw schedule a 10 Tgas callback, so the call attaches more than that.
const CALL_GAS = 100_000_000_000_000n;
const WAIT_UNTIL = 'FINAL';

// retract_report is owner-only. The operator function-call key cannot call it.
const CALLS = {
  withdraw: 'owner',
  set_price: 'owner',
  set_operator: 'owner',
  set_treasury: 'owner',
  propose_owner: 'owner',
  accept_owner: 'pending-owner',
  refund: 'operator',
  confirm_binding: 'deployed',
  retract_report: 'owner',
};

class UsageError extends Error {}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function usage() {
  return 'usage: near:local view|call <method> [args-json]';
}

function redact(message) {
  return String(message).replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/g, 'ed25519:[redacted]');
}

function requireMethod(name) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)) throw new UsageError('method name is invalid');
  return name;
}

function parseArgs(raw) {
  if (raw === undefined) return {};
  let args;
  try {
    args = JSON.parse(raw);
  } catch {
    throw new UsageError('args are not JSON');
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new UsageError('args must be a JSON object');
  return args;
}

function printJson(value) {
  const text = JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2);
  process.stdout.write(`${text}\n`);
}

function yoctoArg(value, label) {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value;
  if (typeof value === 'bigint' && value >= 0n) return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new Error(`${label} must be a yocto decimal string`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`cannot read ${path.basename(file)}`);
  }
}

function publicKeyOf(secret) {
  try {
    return KeyPair.fromString(secret).getPublicKey().toString();
  } catch {
    throw new Error('seeded key is not an ed25519 secret');
  }
}

function parseKey(file, parsed) {
  const id = parsed && typeof parsed.account_id === 'string' ? parsed.account_id : '';
  const secret = parsed && typeof parsed.private_key === 'string'
    ? parsed.private_key
    : (parsed && typeof parsed.secret_key === 'string' ? parsed.secret_key : '');
  if (!id || !/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(secret)) throw new Error(`${path.basename(file)} is not a seeded key`);
  return { accountId: id, secret, publicKey: publicKeyOf(secret) };
}

function namedKey(name) {
  const doc = readJson(ACCOUNTS_FILE);
  const row = doc && doc.accounts && doc.accounts[name];
  if (!row || typeof row.accountId !== 'string' || typeof row.keyFile !== 'string') {
    throw new Error(`accounts.json has no ${name} key`);
  }
  const file = path.resolve(ROOT, row.keyFile);
  const key = parseKey(file, readJson(file));
  if (key.accountId !== row.accountId) throw new Error(`${name} key file does not match accounts.json`);
  if (typeof row.publicKey === 'string' && row.publicKey !== key.publicKey) {
    throw new Error(`${name} key file does not match accounts.json`);
  }
  return key;
}

function keysFor(id) {
  if (!fs.existsSync(KEYS_DIR)) return [];
  const found = [];
  for (const name of fs.readdirSync(KEYS_DIR)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(KEYS_DIR, name);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!parsed || parsed.account_id !== id) continue;
    found.push(parseKey(file, parsed));
  }
  return found;
}

function permissionCall(permission) {
  if (!permission || typeof permission !== 'object') return null;
  return permission.FunctionCall ?? permission.functionCall ?? null;
}

function permitKind(access, method) {
  if (!access) return null;
  if (access.permission === 'FullAccess') return 'full';
  const call = permissionCall(access.permission);
  if (!call) return null;
  const receiver = call.receiver_id ?? call.receiverId;
  const methods = call.method_names ?? call.methodNames;
  if (receiver === CONTRACT_ID && Array.isArray(methods) && methods.includes(method)) return 'function';
  return null;
}

async function chooseKey(rpc, id, method) {
  const keys = keysFor(id);
  if (keys.length === 0) throw new Error(`no seeded key for ${id}`);
  const ranked = [];
  for (const key of keys) {
    let access;
    try {
      access = await rpc.viewAccessKey({
        accountId: id,
        publicKey: key.publicKey,
        finalityQuery: { finality: 'final' },
      });
    } catch {
      continue;
    }
    const kind = permitKind(access, method);
    if (kind) ranked.push({ key, kind });
  }
  if (ranked.length === 0) throw new Error(`no seeded key for ${id} can call ${method}`);
  const full = ranked.find((row) => row.kind === 'full');
  return (full ?? ranked[0]).key;
}

async function signerFor(method, args, rpc) {
  const kind = CALLS[method];
  if (kind === 'owner') return namedKey('owner');
  if (kind === 'operator') return namedKey('operator');
  if (kind === 'pending-owner') {
    const config = await callView(CONTRACT_ID, 'get_config', {});
    const id = config && typeof config.pending_owner === 'string' ? config.pending_owner : '';
    if (!id) throw new Error('no pending owner');
    return chooseKey(rpc, id, method);
  }
  if (kind === 'deployed') {
    const hash = typeof args.request_hash === 'string' ? args.request_hash : '';
    if (!hash) throw new Error('confirm_binding needs request_hash');
    const attestation = await callView(CONTRACT_ID, 'get_attestation', { request_hash: hash });
    const id = attestation && typeof attestation.deployed === 'string' ? attestation.deployed : '';
    if (!id) throw new Error('attestation has no deployed account');
    return chooseKey(rpc, id, method);
  }
  throw new UsageError(`call: unknown method ${method}`);
}

function eventLines(result) {
  const lines = [];
  const take = (logs) => {
    if (!Array.isArray(logs)) return;
    for (const line of logs) {
      if (typeof line === 'string' && line.startsWith('EVENT_JSON:')) lines.push(line);
    }
  };
  take(result?.transaction_outcome?.outcome?.logs);
  const receipts = result?.receipts_outcome;
  if (Array.isArray(receipts)) {
    for (const receipt of receipts) take(receipt?.outcome?.logs);
  }
  return lines;
}

function failureText(status) {
  if (status && typeof status === 'object' && 'SuccessValue' in status) return null;
  const text = typeof status === 'string' ? status : JSON.stringify(status ?? null);
  const code = /ERR_[A-Z0-9_]+/.exec(text);
  if (code) return code[0];
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function printCall(result) {
  process.stdout.write(`tx: ${txHash(result)}\n`);
  for (const line of eventLines(result)) process.stdout.write(`${line}\n`);
  const failure = failureText(result?.status);
  if (failure) {
    console.error(redact(failure));
    process.exit(1);
  }
}

async function prepareArgs(method, args) {
  if (method !== 'withdraw' || args.amount !== undefined) {
    if (method === 'withdraw') return { ...args, amount: yoctoArg(args.amount, 'amount') };
    return args;
  }
  const amount = await callView(CONTRACT_ID, 'get_withdrawable', {});
  return { ...args, amount: yoctoArg(amount, 'get_withdrawable') };
}

export async function viewCommand(argv) {
  if (argv.length < 1 || argv.length > 2) throw new UsageError('usage: near:local view <method> [args-json]');
  const method = requireMethod(argv[0]);
  const args = parseArgs(argv[1]);
  printJson(await callView(CONTRACT_ID, method, args));
}

export async function callCommand(argv) {
  if (argv.length < 1 || argv.length > 2) throw new UsageError('usage: near:local call <method> [args-json]');
  const method = requireMethod(argv[0]);
  if (!Object.prototype.hasOwnProperty.call(CALLS, method)) throw new UsageError(`call: unknown method ${method}`);
  const args = await prepareArgs(method, parseArgs(argv[1]));
  const rpc = provider();
  const key = await signerFor(method, args, rpc);
  const account = new Account(key.accountId, rpc, KeyPairSigner.fromSecretKey(key.secret));
  const result = await account.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions: [actions.functionCall(method, args, CALL_GAS, 0n)],
    waitUntil: WAIT_UNTIL,
    throwOnFailure: false,
  });
  printCall(result);
}

async function main() {
  const argv = process.argv.slice(2);
  const verb = argv[0];
  if (verb === 'view') return viewCommand(argv.slice(1));
  if (verb === 'call') return callCommand(argv.slice(1));
  throw new UsageError(usage());
}

if (isDirectRun()) {
  main().catch((error) => {
    const message = redact(error instanceof Error ? error.message : String(error));
    console.error(error instanceof UsageError ? message : `ops: ${message}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  });
}
