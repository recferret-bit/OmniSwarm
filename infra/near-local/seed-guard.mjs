// Guard fixtures after the core seed: good-dex (low), drained-vault (critical), phish (reported).
// get_attestation_for_account only returns a confirmed binding. alice/bob pay, so the fixture
// account calls confirm_binding itself. A second run keeps existing code, attestations, and reports.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Account, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { AccountDoesNotExistError, GarbageCollectedBlockError, UnknownBlockError } from 'near-api-js/rpc-errors';
import { ACCOUNTS_FILE, KEYS_DIR, NEAR_ROOT, ROOT, VALIDATOR_KEY, keyFile } from './lib/paths.mjs';
import {
  ACCOUNT_BALANCE,
  CONTRACT_ID,
  INIT_GAS,
  MASTER_ID,
  ONE_NEAR,
  accountId,
  callView,
  provider,
  sleep,
  txHash,
} from './lib/rpc.mjs';

const CREATED_FILE = path.join(NEAR_ROOT, 'created.json');
const FIXTURES = path.join(ROOT, 'infra/near-local/fixtures');
const EMPTY_CODE_HASH = '11111111111111111111111111111111';
const EVIDENCE_URI = 'https://omniswarm.localhost/evidence/phish';
const CALL_GAS = INIT_GAS;
const FINAL = { finality: 'final' };

const CONTRACTS = [
  { name: 'good-dex', wasm: 'good-dex.wasm', severity: 'low', payer: 'alice' },
  { name: 'drained-vault', wasm: 'drained-vault.wasm', severity: 'critical', payer: 'bob' },
];

function errorName(error) {
  return error instanceof Error ? error.name : '';
}

function isMissingAccount(error) {
  return error instanceof AccountDoesNotExistError || errorName(error) === 'AccountDoesNotExistError';
}

function isUnreadableBlock(error) {
  if (error instanceof UnknownBlockError || error instanceof GarbageCollectedBlockError) return true;
  const name = errorName(error);
  if (name === 'UnknownBlockError' || name === 'GarbageCollectedBlockError') return true;
  const message = error instanceof Error ? error.message : '';
  return /garbage collected|never been observed|DB Not Found|UNKNOWN_BLOCK/i.test(message);
}

function signerAccount(id, secret, rpc) {
  return new Account(id, rpc, KeyPairSigner.fromSecretKey(secret));
}

function readValidatorSecret() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(VALIDATOR_KEY, 'utf8'));
  } catch {
    throw new Error('cannot read the sandbox validator key; run near:local up');
  }
  const secret = parsed && typeof parsed.secret_key === 'string' ? parsed.secret_key : '';
  if (!parsed || parsed.account_id !== MASTER_ID || !/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(secret)) {
    throw new Error('validator_key.json is not the sandbox test.near key');
  }
  return secret;
}

function readSecret(file, expectedId) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`cannot read ${path.basename(file)}`);
  }
  const secret = parsed && (parsed.private_key || parsed.secret_key);
  if (typeof secret !== 'string' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(secret)) {
    throw new Error(`${path.basename(file)} has no ed25519 key`);
  }
  if (expectedId && parsed.account_id && parsed.account_id !== expectedId) {
    throw new Error(`${path.basename(file)} is for ${parsed.account_id}`);
  }
  return secret;
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

function loadKey(name, id) {
  const file = keyFile(name);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`cannot read ${name}.json`);
  }
  if (parsed && parsed.account_id && parsed.account_id !== id) {
    throw new Error(`${name}.json is for ${parsed.account_id}, not ${id}`);
  }
  const secret = readSecret(file);
  const pair = KeyPair.fromString(secret);
  return { secret, publicKey: pair.getPublicKey(), publicId: pair.getPublicKey().toString() };
}

function mintKey(name, id) {
  const pair = KeyPair.fromRandom('ed25519');
  const key = { secret: pair.toString(), publicKey: pair.getPublicKey(), publicId: pair.getPublicKey().toString() };
  writeKeyFile(name, id, key);
  return key;
}

function readWasm(fileName) {
  const file = path.join(FIXTURES, fileName);
  const wasm = new Uint8Array(fs.readFileSync(file));
  if (wasm.byteLength < 4) throw new Error(`${fileName} is empty`);
  return wasm;
}

async function send(account, receiverId, txActions) {
  const result = await account.signAndSendTransaction({
    receiverId,
    actions: txActions,
    waitUntil: 'FINAL',
  });
  return { hash: txHash(result), result };
}

async function viewAccountFinal(rpc, id) {
  try {
    return await rpc.viewAccount({ accountId: id, blockQuery: FINAL });
  } catch (error) {
    if (isMissingAccount(error)) return null;
    throw error;
  }
}

async function waitUntil(label, read) {
  const deadline = Date.now() + 30_000;
  let last = 'not ready';
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
      last = 'not ready';
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(400);
  }
  throw new Error(`${label} did not become visible: ${last}`);
}

function timestampNs(header) {
  const raw = header && (header.timestamp_nanosec ?? header.timestampNanosec);
  const text = typeof raw === 'bigint' ? raw.toString() : typeof raw === 'string' ? raw : '';
  if (!/^\d{1,22}$/.test(text)) throw new Error('block timestamp_nanosec is not a decimal string');
  return text;
}

async function blockHeader(rpc, blockQuery) {
  const block = await rpc.viewBlock(blockQuery);
  const header = block && block.header;
  if (!header || !Number.isInteger(header.height) || header.height < 0) throw new Error('block has no height');
  return { blockTimestampNs: timestampNs(header), blockHeight: header.height };
}

function receiptBlockHash(result, id) {
  const receipts = result?.receipts_outcome ?? result?.receiptsOutcome ?? [];
  const list = Array.isArray(receipts) ? receipts : [];
  const match = list.find((row) => (row?.outcome?.executor_id ?? row?.outcome?.executorId) === id);
  const chosen = match ?? list[0] ?? result?.transaction_outcome ?? result?.transactionOutcome;
  const hash = chosen?.block_hash ?? chosen?.blockHash;
  if (typeof hash !== 'string' || hash.length === 0) throw new Error('transaction result has no block hash');
  return hash;
}

async function blockOfResult(rpc, result, id) {
  const hash = receiptBlockHash(result, id);
  return waitUntil(`block ${hash}`, async () => {
    try {
      return await blockHeader(rpc, { blockId: hash });
    } catch (error) {
      if (isUnreadableBlock(error)) return null;
      throw error;
    }
  });
}

// Headers outlive state. A height is usable only when view_account can read it.
async function stateReadable(rpc, height) {
  try {
    await rpc.viewAccount({ accountId: MASTER_ID, blockQuery: { blockId: height } });
    return true;
  } catch (error) {
    if (isMissingAccount(error)) return true;
    if (isUnreadableBlock(error)) return false;
    throw error;
  }
}

async function accountAt(rpc, id, height) {
  try {
    return await rpc.viewAccount({ accountId: id, blockQuery: { blockId: height } });
  } catch (error) {
    if (isMissingAccount(error)) return null;
    throw error;
  }
}

async function stateFloor(rpc, headHeight) {
  if (await stateReadable(rpc, 0)) return 0;
  let lo = 0;
  let hi = headHeight;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (await stateReadable(rpc, mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

// First height at which the account exists. Null when that block is outside kept state.
async function findCreation(rpc, id, headHeight, floor) {
  if (!await accountAt(rpc, id, headHeight)) return null;
  let lo = floor;
  let sawAbsent = false;
  while (lo < headHeight) {
    try {
      const atFloor = await accountAt(rpc, id, lo);
      if (atFloor) {
        if (lo === 0) return blockHeader(rpc, { blockId: 0 });
        return null;
      }
      sawAbsent = true;
      break;
    } catch (error) {
      if (!isUnreadableBlock(error)) throw error;
      lo += 1;
    }
  }
  if (!sawAbsent) return null;
  let hi = headHeight;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    let atMid;
    try {
      atMid = await accountAt(rpc, id, mid);
    } catch (error) {
      if (!isUnreadableBlock(error)) throw error;
      lo = mid;
      continue;
    }
    if (atMid) hi = mid;
    else lo = mid;
  }
  return blockHeader(rpc, { blockId: hi });
}

function requestHashFor(id) {
  return createHash('sha256').update(`omniswarm-local-guard:${id}`).digest('hex');
}

function attestArgs(name, id, codeHash, severity) {
  return {
    request_hash: requestHashFor(id),
    repo: `omniswarm/${name}`,
    commit: createHash('sha256').update(`${id}:commit`).digest('hex').slice(0, 40),
    report_sha256: createHash('sha256').update(`${id}:report`).digest('hex'),
    report_uri: `https://omniswarm.localhost/reports/${name}`,
    deployed: id,
    code_hash: codeHash,
    max_severity: severity,
  };
}

function statusOf(request) {
  return request && typeof request.status === 'string' ? request.status : '';
}

async function ensurePlainAccount(master, rpc, name, records) {
  const id = accountId(name);
  const existing = await viewAccountFinal(rpc, id);
  if (existing) return;
  const key = loadKey(name, id) ?? mintKey(name, id);
  const sent = await send(master, id, [
    actions.createAccount(),
    actions.transfer(ACCOUNT_BALANCE),
    actions.addFullAccessKey(key.publicKey),
  ]);
  records[id] = await blockOfResult(rpc, sent.result, id);
  console.log(`${id}  created  ${sent.hash}`);
  await waitUntil(id, () => viewAccountFinal(rpc, id));
}

async function ensureCode(master, rpc, spec, records) {
  const id = accountId(spec.name);
  await ensurePlainAccount(master, rpc, spec.name, records);
  const existing = await viewAccountFinal(rpc, id);
  if (existing && existing.code_hash && existing.code_hash !== EMPTY_CODE_HASH) {
    console.log(`${id}  code  already`);
    return existing.code_hash;
  }
  const key = loadKey(spec.name, id);
  if (!key) throw new Error(`${id} has code to deploy but no key file`);
  const wasm = readWasm(spec.wasm);
  const account = signerAccount(id, key.secret, rpc);
  const sent = await send(account, id, [actions.deployContract(wasm)]);
  console.log(`${id}  deploy  ${sent.hash}`);
  const codeHash = await waitUntil(`${id} code`, async () => {
    const view = await viewAccountFinal(rpc, id);
    if (view && view.code_hash && view.code_hash !== EMPTY_CODE_HASH) return view.code_hash;
    return null;
  });
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(codeHash)) throw new Error(`${id} code_hash is not base58`);
  return codeHash;
}

async function ensureAttestation(operator, payer, rpc, spec, codeHash) {
  const id = accountId(spec.name);
  const hash = requestHashFor(id);
  const bound = await callView(CONTRACT_ID, 'get_attestation_for_account', { account: id });
  if (bound && bound.max_severity === spec.severity && bound.deployed === id) {
    console.log(`${id}  ${spec.severity}  already attested`);
    return;
  }
  let request = await callView(CONTRACT_ID, 'get_request', { request_hash: hash });
  if (!request) {
    const sent = await send(payer, CONTRACT_ID, [
      actions.functionCall('request_review', { request_hash: hash }, CALL_GAS, ONE_NEAR),
    ]);
    console.log(`${id}  request_review  ${sent.hash}`);
    request = await waitUntil(`${id} request`, () => callView(CONTRACT_ID, 'get_request', { request_hash: hash }));
  }
  let status = statusOf(request);
  if (status === 'Refunded') throw new Error(`${id} request ${hash} is refunded`);
  if (status === 'Pending') {
    const sent = await send(operator, CONTRACT_ID, [
      actions.functionCall('mark_running', { request_hash: hash }, CALL_GAS, 0n),
    ]);
    console.log(`${id}  mark_running  ${sent.hash}`);
    request = await waitUntil(`${id} running`, async () => {
      const row = await callView(CONTRACT_ID, 'get_request', { request_hash: hash });
      const next = statusOf(row);
      if (next === 'Running' || next === 'Done') return row;
      return null;
    });
    status = statusOf(request);
  }
  let attestation = await callView(CONTRACT_ID, 'get_attestation', { request_hash: hash });
  if (!attestation) {
    if (status !== 'Running' && status !== 'Pending') throw new Error(`${id} status ${status} has no attestation`);
    const args = attestArgs(spec.name, id, codeHash, spec.severity);
    const sent = await send(operator, CONTRACT_ID, [
      actions.functionCall('attest', args, CALL_GAS, 0n),
    ]);
    console.log(`${id}  attest  ${sent.hash}`);
    attestation = await waitUntil(`${id} attestation`, () => callView(CONTRACT_ID, 'get_attestation', { request_hash: hash }));
  }
  if (attestation.max_severity !== spec.severity) {
    throw new Error(`${id} attestation severity is ${attestation.max_severity}, want ${spec.severity}`);
  }
  if (attestation.binding_confirmed === true && attestation.deployed === id) {
    await waitUntil(`${id} binding`, async () => {
      const row = await callView(CONTRACT_ID, 'get_attestation_for_account', { account: id });
      return row && row.max_severity === spec.severity ? row : null;
    });
    return;
  }
  if (attestation.deployed !== id) throw new Error(`${id} attestation is not deployed to the fixture`);
  const key = loadKey(spec.name, id);
  if (!key) throw new Error(`${id} must confirm_binding but has no key file`);
  const fixture = signerAccount(id, key.secret, rpc);
  const sent = await send(fixture, CONTRACT_ID, [
    actions.functionCall('confirm_binding', { request_hash: hash }, CALL_GAS, 0n),
  ]);
  console.log(`${id}  confirm_binding  ${sent.hash}`);
  await waitUntil(`${id} binding`, async () => {
    const row = await callView(CONTRACT_ID, 'get_attestation_for_account', { account: id });
    return row && row.max_severity === spec.severity ? row : null;
  });
}

async function ensureReport(operator) {
  const id = accountId('phish');
  const reported = await callView(CONTRACT_ID, 'is_reported', { account_id: id });
  if (reported === true) {
    console.log(`${id}  reported  already`);
    return;
  }
  const sent = await send(operator, CONTRACT_ID, [
    actions.functionCall('report_address', {
      account_id: id,
      evidence_uri: EVIDENCE_URI,
      reason: 'phishing account',
    }, CALL_GAS, 0n),
  ]);
  console.log(`${id}  report_address  ${sent.hash}`);
  await waitUntil(`${id} report`, async () => {
    const value = await callView(CONTRACT_ID, 'is_reported', { account_id: id });
    return value === true ? true : null;
  });
}

function readCreated() {
  if (!fs.existsSync(CREATED_FILE)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(CREATED_FILE, 'utf8'));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const records = {};
  for (const [id, row] of Object.entries(parsed)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const raw = row.blockTimestampNs;
    const timestamp = typeof raw === 'string'
      ? raw
      : typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : '';
    const height = row.blockHeight;
    if (!/^\d{1,22}$/.test(timestamp) || !Number.isInteger(height) || height < 0) continue;
    records[id] = { blockTimestampNs: timestamp, blockHeight: height };
  }
  return records;
}

function accountIdsFromFile() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return [];
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  } catch {
    return [];
  }
  const accounts = doc && doc.accounts;
  if (!accounts || typeof accounts !== 'object') return [];
  const ids = [];
  for (const row of Object.values(accounts)) {
    if (row && typeof row.accountId === 'string') ids.push(row.accountId);
  }
  return ids;
}

function writeCreated(records) {
  const ordered = {};
  for (const id of Object.keys(records).sort()) {
    const row = records[id];
    if (!row || !/^\d{1,22}$/.test(row.blockTimestampNs) || !Number.isInteger(row.blockHeight)) {
      throw new Error(`created.json entry for ${id} is incomplete`);
    }
    ordered[id] = { blockTimestampNs: row.blockTimestampNs, blockHeight: row.blockHeight };
  }
  const text = `${JSON.stringify(ordered, null, 2)}\n`;
  if (/private_key|secret_key|secretKey|ed25519:/.test(text)) throw new Error('created.json must not contain a key');
  fs.writeFileSync(CREATED_FILE, text);
}

async function fillCreation(rpc, records) {
  const ids = new Set([
    ...accountIdsFromFile(),
    ...CONTRACTS.map((spec) => accountId(spec.name)),
    accountId('phish'),
  ]);
  const missing = [...ids].filter((id) => !records[id]);
  if (missing.length === 0) return;
  let head;
  let floor;
  try {
    head = await blockHeader(rpc, FINAL);
    floor = await stateFloor(rpc, head.blockHeight);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`created.json: chain history is not readable: ${message}`);
    return;
  }
  for (const id of missing) {
    try {
      const found = await findCreation(rpc, id, head.blockHeight, floor);
      if (found) records[id] = found;
      else console.error(`created.json: creation of ${id} is older than kept state`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`created.json: could not read creation of ${id}: ${message}`);
    }
  }
}

export async function seedGuard() {
  const rpc = provider();
  const master = signerAccount(MASTER_ID, readValidatorSecret(), rpc);
  const operator = signerAccount(accountId('operator'), readSecret(keyFile('operator'), accountId('operator')), rpc);
  const payers = {
    alice: signerAccount(accountId('alice'), readSecret(keyFile('alice'), accountId('alice')), rpc),
    bob: signerAccount(accountId('bob'), readSecret(keyFile('bob'), accountId('bob')), rpc),
  };
  const records = readCreated();
  const codeHash = {};
  for (const spec of CONTRACTS) {
    codeHash[spec.name] = await ensureCode(master, rpc, spec, records);
  }
  await ensurePlainAccount(master, rpc, 'phish', records);
  for (const spec of CONTRACTS) {
    const payer = payers[spec.payer];
    if (!payer) throw new Error(`no payer ${spec.payer}`);
    await ensureAttestation(operator, payer, rpc, spec, codeHash[spec.name]);
  }
  await ensureReport(operator);
  await fillCreation(rpc, records);
  writeCreated(records);
  const critical = await callView(CONTRACT_ID, 'get_attestation_for_account', { account: accountId('drained-vault') });
  if (!critical || critical.max_severity !== 'critical') throw new Error('drained-vault attestation is not critical');
  const low = await callView(CONTRACT_ID, 'get_attestation_for_account', { account: accountId('good-dex') });
  if (!low || low.max_severity !== 'low') throw new Error('good-dex attestation is not low');
  const reported = await callView(CONTRACT_ID, 'is_reported', { account_id: accountId('phish') });
  if (reported !== true) throw new Error('phish is not reported');
}
