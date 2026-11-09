// Seeds the local sandbox: six accounts, the registry wasm, `new`, and the operator function-call key.
// operator.json is that function-call key (the worker signs with it). The operator full-access key
// is operator.full.json and is not listed in accounts.json. A second run is "already seeded" only
// when accounts.json validates and get_config matches. --reset calls near-local.sh reset and up,
// then seeds in this process; it does not invoke `near:local seed` again.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Account, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { validate } from '../../packages/schemas/index.mjs';
import { ACCOUNTS_FILE, KEYS_DIR, NEAR_LOCAL_SH, VALIDATOR_KEY, WASM, keyFile, keyFileRel } from './lib/paths.mjs';
import {
  ACCOUNT_BALANCE,
  CONTRACT_ID,
  INIT_GAS,
  MASTER_ID,
  NETWORK,
  OPERATOR_ALLOWANCE,
  OPERATOR_METHODS,
  PRICE_YOCTO,
  RPC_URL,
  SEEDED_NAMES,
  accountId,
  callView,
  provider,
  sleep,
  txHash,
  yocto,
} from './lib/rpc.mjs';

const OPERATOR_FULL = 'operator.full';
const WAIT_UNTIL = 'EXECUTED';

function nearLocal(command) {
  const result = spawnSync('bash', [NEAR_LOCAL_SH, command], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);
}

function refuseSymlink(target) {
  try {
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error(`${target} is a symlink; not removing it`);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
}

function wipeSeedFiles() {
  refuseSymlink(KEYS_DIR);
  refuseSymlink(ACCOUNTS_FILE);
  fs.rmSync(KEYS_DIR, { recursive: true, force: true });
  fs.rmSync(ACCOUNTS_FILE, { force: true });
}

function readValidatorSecret() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(VALIDATOR_KEY, 'utf8'));
  } catch {
    throw new Error('cannot read the sandbox validator key; run near:local up');
  }
  const secret = parsed && typeof parsed.secret_key === 'string' ? parsed.secret_key : '';
  const id = parsed && parsed.account_id;
  if (id !== MASTER_ID || !/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(secret)) {
    throw new Error('validator_key.json is not the sandbox test.near key');
  }
  return secret;
}

function freshKey() {
  const pair = KeyPair.fromRandom('ed25519');
  return { secret: pair.toString(), publicKey: pair.getPublicKey(), publicId: pair.getPublicKey().toString() };
}

function writeKeyFile(name, id, key) {
  fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(KEYS_DIR, 0o700);
  const file = keyFile(name);
  const body = `${JSON.stringify({ account_id: id, public_key: key.publicId, private_key: key.secret }, null, 2)}\n`;
  const fd = fs.openSync(file, 'w', 0o600);
  try {
    fs.writeSync(fd, body);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(file, 0o600);
  const mode = fs.statSync(file).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error(`refusing to leave ${name}.json readable by group or others`);
}

function configMatches(config) {
  return Boolean(config)
    && config.owner === accountId('owner')
    && config.operator === accountId('operator')
    && config.treasury === accountId('treasury')
    && yocto(config.price) === PRICE_YOCTO;
}

async function isAlreadySeeded() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return false;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  } catch {
    return false;
  }
  if (!validate('near-local-accounts', doc).ok) return false;
  let config;
  try {
    config = await callView(CONTRACT_ID, 'get_config', {});
  } catch {
    return false;
  }
  if (!configMatches(config)) {
    throw new Error('accounts.json is present but get_config does not match; run near:local seed --reset');
  }
  return true;
}

function signerAccount(id, secret, rpc) {
  return new Account(id, rpc, KeyPairSigner.fromSecretKey(secret));
}

async function send(account, receiverId, txActions) {
  const result = await account.signAndSendTransaction({
    receiverId,
    actions: txActions,
    waitUntil: WAIT_UNTIL,
  });
  return txHash(result);
}

function permissionCall(permission) {
  if (!permission || typeof permission !== 'object') return null;
  return permission.FunctionCall ?? permission.functionCall ?? null;
}

function sameMethods(actual) {
  if (!Array.isArray(actual)) return false;
  const want = [...OPERATOR_METHODS].sort();
  const got = [...actual].sort();
  return want.length === got.length && want.every((name, index) => name === got[index]);
}

async function waitForReady(rpc, operatorFc) {
  const deadline = Date.now() + 30_000;
  let last = 'not ready';
  while (Date.now() < deadline) {
    try {
      const config = await callView(CONTRACT_ID, 'get_config', {});
      const access = await rpc.viewAccessKey({
        accountId: accountId('operator'),
        publicKey: operatorFc,
        finalityQuery: { finality: 'final' },
      });
      const call = permissionCall(access?.permission);
      const methodsOk = call && sameMethods(call.method_names ?? call.methodNames);
      const receiverOk = call && (call.receiver_id ?? call.receiverId) === CONTRACT_ID;
      const allowanceOk = call && yocto(call.allowance) === PRICE_YOCTO;
      if (configMatches(config) && methodsOk && receiverOk && allowanceOk) return config;
      const kind = access?.permission === 'FullAccess' ? 'FullAccess' : (call ? 'FunctionCall' : 'missing');
      last = `config=${configMatches(config)} key=${kind} methods=${methodsOk} receiver=${receiverOk} allowance=${allowanceOk}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(400);
  }
  throw new Error(`seed did not become visible: ${last}`);
}

function writeAccounts(publicIds) {
  const accounts = {};
  for (const name of SEEDED_NAMES) {
    accounts[name] = {
      accountId: accountId(name),
      keyFile: keyFileRel(name),
      publicKey: publicIds[name],
    };
  }
  const doc = {
    network: NETWORK,
    chainId: NETWORK,
    rpcUrl: RPC_URL,
    contractId: CONTRACT_ID,
    priceYocto: PRICE_YOCTO,
    accounts,
  };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (text.includes('private_key') || text.includes('secret_key') || text.includes('secretKey')) {
    throw new Error('accounts.json must not contain a key field');
  }
  const checked = validate('near-local-accounts', doc);
  if (!checked.ok) throw new Error(`accounts.json failed schema: ${checked.errors.join('; ')}`);
  fs.writeFileSync(ACCOUNTS_FILE, text);
}

function printTable(rows) {
  const header = ['account', 'account_id', 'tx'];
  const width = header.map((cell) => cell.length);
  for (const row of rows) row.forEach((cell, index) => { width[index] = Math.max(width[index], cell.length); });
  const format = (cols) => cols.map((cell, index) => cell.padEnd(width[index])).join('  ');
  console.log(format(header));
  for (const row of rows) console.log(format(row));
}

async function seed() {
  if (!fs.existsSync(WASM)) throw new Error('missing contracts/review-registry/res/review_registry.wasm');
  const wasm = new Uint8Array(fs.readFileSync(WASM));
  if (wasm.byteLength < 4) throw new Error('registry wasm is empty');
  const rpc = provider();
  const master = signerAccount(MASTER_ID, readValidatorSecret(), rpc);
  const rows = [];
  const full = {};
  for (const name of [...SEEDED_NAMES, 'registry']) {
    const id = name === 'registry' ? CONTRACT_ID : accountId(name);
    const key = freshKey();
    const fileStem = name === 'operator' ? OPERATOR_FULL : name;
    writeKeyFile(fileStem, id, key);
    full[name] = key;
    const hash = await send(master, id, [
      actions.createAccount(),
      actions.transfer(ACCOUNT_BALANCE),
      actions.addFullAccessKey(key.publicKey),
    ]);
    rows.push([name, id, hash]);
  }
  const registry = signerAccount(CONTRACT_ID, full.registry.secret, rpc);
  const deployHash = await send(registry, CONTRACT_ID, [actions.deployContract(wasm)]);
  rows.push(['deploy', CONTRACT_ID, deployHash]);
  const initHash = await send(registry, CONTRACT_ID, [
    actions.functionCall('new', {
      owner: accountId('owner'),
      operator: accountId('operator'),
      treasury: accountId('treasury'),
      price_yocto: PRICE_YOCTO,
    }, INIT_GAS, 0n),
  ]);
  rows.push(['new', CONTRACT_ID, initHash]);
  const operatorFc = freshKey();
  writeKeyFile('operator', accountId('operator'), operatorFc);
  const operator = signerAccount(accountId('operator'), full.operator.secret, rpc);
  const keyHash = await send(operator, accountId('operator'), [
    actions.addFunctionCallAccessKey(operatorFc.publicKey, CONTRACT_ID, OPERATOR_METHODS, OPERATOR_ALLOWANCE),
  ]);
  rows.push(['operator-key', accountId('operator'), keyHash]);
  await waitForReady(rpc, operatorFc.publicId);
  const publicIds = {};
  for (const name of SEEDED_NAMES) publicIds[name] = full[name].publicId;
  publicIds.operator = operatorFc.publicId;
  writeAccounts(publicIds);
  printTable(rows);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--reset')) {
    console.error('usage: near:local seed [--reset]');
    process.exit(2);
  }
  const reset = args.includes('--reset');
  if (reset) {
    wipeSeedFiles();
    nearLocal('reset');
  }
  nearLocal('up');
  if (!reset && await isAlreadySeeded()) {
    console.log('already seeded');
    await seedGuardIfPresent();
    return;
  }
  await seed();
  await seedGuardIfPresent();
}

async function seedGuardIfPresent() {
  try {
    const guard = await import('./seed-guard.mjs');
    if (typeof guard.seedGuard === 'function') await guard.seedGuard();
  } catch (error) {
    if (error && error.code === 'ERR_MODULE_NOT_FOUND') return;
    throw error;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
