// Sandbox helpers for the headless flow. Keys stay in memory and are never printed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KeyPair, Account, JsonRpcProvider, KeyPairSigner, actions } from 'near-api-js';
import { canonicalRequestMessage } from '@omniswarm/schemas/canonical-message';
import { b58decode } from '@omniswarm/schemas/nep413';
import { encodePublicKey, rawPublicKey, signNep413 } from '../../../apps/api/src/modules/auth/nep413.ts';
import { panicReason } from '../../../apps/api/src/chain/near/payment-tx.ts';
import { CONTRACT_ID, PRICE_YOCTO, RPC_URL, callView } from '../../../infra/near-local/lib/rpc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const KEYS = path.join(ROOT, 'infra/compose/.local/near/keys');
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const CALL_GAS = 100_000_000_000_000n;
const PAY_GAS = 30_000_000_000_000n;

export { CONTRACT_ID, PRICE_YOCTO, RPC_URL, ROOT, callView };

export const RECIPIENT = 'treasury.test.near';
export const REPO = 'near/near-sdk-rs';
export const COMMIT = '5c7a2f1e9b3d4c6a8e0f1a2b3c4d5e6f7a8b9c0d';
export const PRESET = 'scripted';

export function redact(message) {
  return String(message)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://[redacted]')
    .replace(/ed25519:[1-9A-HJ-NP-Za-km-z]+/g, 'ed25519:[redacted]');
}

export function keyFile(name) {
  return path.join(KEYS, `${name}.json`);
}

/** Seeded full-access or function-call key. `key` signs NEP-413; `secret` signs transactions. */
export function loadSigningKey(name) {
  const file = keyFile(name);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const secret = parsed.private_key ?? parsed.secret_key ?? '';
  if (typeof parsed.account_id !== 'string' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(secret)) {
    throw new Error(`${name}.json is not a seeded ed25519 key`);
  }
  const raw = Buffer.from(b58decode(secret.slice('ed25519:'.length)));
  if (raw.length < 32) throw new Error(`${name}.json secret is too short`);
  const key = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519, raw.subarray(0, 32)]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = encodePublicKey(rawPublicKey(crypto.createPublicKey(key)));
  const nearPublic = KeyPair.fromString(secret).getPublicKey().toString();
  if (publicKey !== nearPublic || (typeof parsed.public_key === 'string' && parsed.public_key !== publicKey)) {
    throw new Error(`${name}.json public key does not match the secret`);
  }
  return { accountId: parsed.account_id, publicKey, secret, key };
}

/** Canonical request message, signed with the seeded key the way the intake API verifies NEP-413. */
export function signRequest(who, nonce, fields = {}) {
  const message = canonicalRequestMessage({
    account: who.accountId,
    commit: fields.commit ?? COMMIT,
    deployed: fields.deployed ?? null,
    network: 'sandbox',
    nonce,
    preset: fields.preset ?? PRESET,
    repo: fields.repo ?? REPO,
  });
  const signature = signNep413(who.key, message, Buffer.from(nonce, 'base64'), RECIPIENT);
  return { accountId: who.accountId, publicKey: who.publicKey, signature, message, nonce };
}

function provider() {
  return new JsonRpcProvider({ url: RPC_URL }, { retries: 5, wait: 200, backoff: 1.5 });
}

async function send(accountId, secret, method, args, gas, deposit) {
  const account = new Account(accountId, provider(), KeyPairSigner.fromSecretKey(secret));
  let response;
  try {
    response = await account.signAndSendTransaction({
      receiverId: CONTRACT_ID,
      actions: [actions.functionCall(method, args, gas, deposit)],
      waitUntil: 'FINAL',
      throwOnFailure: false,
    });
  } catch (error) {
    throw new Error(`${method} failed: ${redact(error instanceof Error ? error.message : error)}`);
  }
  const reason = panicReason(response);
  if (reason) throw new Error(`${method} ${reason}`);
  const hash = response?.transaction?.hash;
  if (typeof hash !== 'string' || hash.length === 0) throw new Error(`${method} returned no transaction hash`);
  return hash;
}

/** Payable `request_review` for the quoted price, signed by a seeded full-access key. */
export function requestReview(who, requestHash, depositYocto) {
  return send(who.accountId, who.secret, 'request_review', { request_hash: requestHash }, PAY_GAS, BigInt(depositYocto));
}

/** Owner `withdraw` of `get_withdrawable`. Returns the tx hash and the amount sent. */
export async function withdrawEarned() {
  const raw = await callView(CONTRACT_ID, 'get_withdrawable', {});
  const amount = typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'bigint' ? String(raw) : '';
  if (!/^[1-9][0-9]*$/.test(amount)) throw new Error(`nothing to withdraw (${amount || 'empty'})`);
  const owner = loadSigningKey('owner');
  const before = await provider().viewAccount({ accountId: 'treasury.test.near', blockQuery: { finality: 'final' } });
  const txHash = await send(owner.accountId, owner.secret, 'withdraw', { amount }, CALL_GAS, 0n);
  const after = await provider().viewAccount({ accountId: 'treasury.test.near', blockQuery: { finality: 'final' } });
  return { txHash, amount, treasuryBefore: BigInt(before.amount), treasuryAfter: BigInt(after.amount) };
}

export async function sandboxSkipReason() {
  try {
    const response = await fetch(`${RPC_URL}/status`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return `near-sandbox not running at ${RPC_URL} (HTTP ${response.status})`;
    const body = await response.json();
    if (body?.chain_id !== 'sandbox') return `near-sandbox not running at ${RPC_URL} (chain_id ${body?.chain_id ?? 'missing'}, want sandbox)`;
    return '';
  } catch (error) {
    return `near-sandbox not running at ${RPC_URL} (${redact(error instanceof Error ? error.message : error)})`;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Local indexer so guard account age is the creation time seed recorded. */
export async function startIndexer() {
  const port = await freePort();
  if (port === 3030 || port === 3190) throw new Error(`refusing indexer port ${port}`);
  const child = spawn(process.execPath, [
    path.join(ROOT, 'infra/near-local/indexer.mjs'),
    '--port', String(port),
    '--rpc', RPC_URL,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`indexer exited ${child.exitCode}: ${redact(stderr)}`);
    try {
      const response = await fetch(`${url}/v1/account/good-dex.test.near`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return { url, child };
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error(`indexer did not listen on ${url}: ${redact(stderr)}`);
}

export async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
