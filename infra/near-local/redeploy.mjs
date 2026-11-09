// `near:local redeploy <fixture> [--alt]`
// Deploys a guard-fixture wasm with that account's own key. `--alt` deploys the other
// fixture wasm, so the live code hash drifts from the attestation.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Account, KeyPairSigner, actions } from 'near-api-js';
import { ROOT, keyFile } from './lib/paths.mjs';
import { CONTRACT_ID, accountId, callView, provider, sleep, txHash } from './lib/rpc.mjs';

const FIXTURES = path.join(ROOT, 'infra/near-local/fixtures');
const WASM = Object.freeze({
  'good-dex': 'good-dex.wasm',
  'drained-vault': 'drained-vault.wasm',
});
const WAIT_UNTIL = 'FINAL';

class UsageError extends Error {}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function redact(message) {
  return String(message).replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/g, 'ed25519:[redacted]');
}

function usage() {
  return 'usage: near:local redeploy <good-dex|drained-vault> [--alt]';
}

/**
 * @param {string[]} argv
 * @returns {{ name: string, alt: boolean }}
 */
export function parseRedeployArgs(argv) {
  let alt = false;
  /** @type {string[]} */
  const names = [];
  for (const arg of argv) {
    if (arg === '--alt') alt = true;
    else if (arg === '--help' || arg === '-h') throw new UsageError(usage());
    else if (arg.startsWith('--')) throw new UsageError(`unknown flag ${arg}`);
    else names.push(arg);
  }
  if (names.length !== 1) throw new UsageError(usage());
  const name = fixtureName(names[0]);
  if (!Object.hasOwn(WASM, name)) throw new UsageError(usage());
  return { name, alt };
}

/**
 * @param {string} arg
 */
function fixtureName(arg) {
  if (arg.endsWith('.test.near')) return arg.slice(0, -'.test.near'.length);
  return arg;
}

/**
 * Wasm file for a fixture. `--alt` is the other fixture's wasm.
 * @param {string} name
 * @param {boolean} alt
 */
export function wasmFile(name, alt) {
  const own = WASM[/** @type {keyof typeof WASM} */ (name)];
  if (!own) throw new Error(`no fixture wasm for ${name}`);
  if (!alt) return own;
  const other = Object.entries(WASM).find(([key]) => key !== name);
  if (!other) throw new Error(`no alt wasm for ${name}`);
  return other[1];
}

function readWasm(fileName) {
  const file = path.join(FIXTURES, fileName);
  const wasm = new Uint8Array(fs.readFileSync(file));
  if (wasm.byteLength < 4) throw new Error(`${fileName} is empty`);
  return wasm;
}

function readSecret(name, id) {
  const file = keyFile(name);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`cannot read ${name}.json; run near:local seed`);
  }
  const secret = parsed && (parsed.private_key || parsed.secret_key);
  if (typeof secret !== 'string' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(secret)) {
    throw new Error(`${name}.json has no ed25519 key`);
  }
  if (parsed.account_id && parsed.account_id !== id) throw new Error(`${name}.json is for ${parsed.account_id}`);
  return secret;
}

/**
 * @param {import('near-api-js').JsonRpcProvider} rpc
 * @param {string} id
 */
async function codeHashOf(rpc, id) {
  const view = await rpc.viewAccount({ accountId: id, blockQuery: { finality: 'final' } });
  const hash = view && view.code_hash;
  if (typeof hash !== 'string' || hash.length === 0) throw new Error(`${id} has no code_hash`);
  return hash;
}

/**
 * @param {{ name: string, alt: boolean }} request
 */
export async function redeploy(request) {
  const id = accountId(request.name);
  const fileName = wasmFile(request.name, request.alt);
  const wasm = readWasm(fileName);
  const rpc = provider();
  const before = await codeHashOf(rpc, id);
  const account = new Account(id, rpc, KeyPairSigner.fromSecretKey(readSecret(request.name, id)));
  const result = await account.signAndSendTransaction({
    receiverId: id,
    actions: [actions.deployContract(wasm)],
    waitUntil: WAIT_UNTIL,
    throwOnFailure: true,
  });
  const hash = txHash(result);
  let after = before;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    after = await codeHashOf(rpc, id);
    if (after !== before) break;
    await sleep(400);
  }
  const attestation = await callView(CONTRACT_ID, 'get_attestation_for_account', { account: id });
  const attested = attestation && typeof attestation.code_hash === 'string' ? attestation.code_hash : '';
  if (request.alt && after === before && after === attested) {
    throw new Error(`${id} alt wasm did not change the code hash`);
  }
  process.stdout.write(`${id}  redeploy  ${hash}\n`);
  process.stdout.write(`wasm: ${fileName}\n`);
  process.stdout.write(`code_hash: ${before} -> ${after}\n`);
  if (attested) process.stdout.write(`attested: ${attested}\n`);
  return { id, tx: hash, wasm: fileName, before, after, attested };
}

async function main() {
  const request = parseRedeployArgs(process.argv.slice(2));
  await redeploy(request);
}

if (isDirectRun()) {
  main().catch((error) => {
    const message = redact(error instanceof Error ? error.message : String(error));
    console.error(error instanceof UsageError ? message : `redeploy: ${message}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  });
}
