// `near:local verify <account> [--wasm <path>]`
// Base58 sha256 of a wasm compared with the sandbox view_account code_hash.
// Prints `match` or `drift`. Exit 0 on match, 1 on drift, 2 on usage.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { b58encode } from '../../packages/schemas/nep413.mjs';
import { ROOT } from './lib/paths.mjs';
import { provider, resolveAccount } from './lib/rpc.mjs';

const DEFAULT_WASM = 'contracts/review-registry/res/review_registry.wasm';

class UsageError extends Error {}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function usage() {
  return 'usage: near:local verify <account> [--wasm <path>]';
}

/**
 * @param {string[]} argv
 * @returns {{ account: string, wasm: string | null }}
 */
export function parseVerifyArgs(argv) {
  /** @type {string | null} */
  let wasm = null;
  /** @type {string[]} */
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') throw new UsageError(usage());
    if (arg === '--wasm') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new UsageError(usage());
      wasm = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new UsageError(`unknown flag ${arg}`);
    positionals.push(arg);
  }
  if (positionals.length !== 1) throw new UsageError(usage());
  return { account: positionals[0], wasm };
}

/**
 * NEAR `code_hash` is the base58 of the raw sha256 of the wasm bytes.
 * @param {Uint8Array} bytes
 */
export function codeHashOf(bytes) {
  const digest = createHash('sha256').update(bytes).digest();
  return b58encode(digest);
}

/**
 * @param {string} onChain
 * @param {string} wasmHash
 * @returns {'match' | 'drift'}
 */
export function compareCodeHash(onChain, wasmHash) {
  if (typeof onChain !== 'string' || onChain.length === 0) throw new Error('view_account has no code_hash');
  return onChain === wasmHash ? 'match' : 'drift';
}

/**
 * @param {{ onChain: string, wasmHash: string, wasmPath: string, verdict: 'match' | 'drift' }} result
 */
export function formatVerify(result) {
  const line = `code_hash ${result.onChain} == sha256(${result.wasmPath}) → ${result.verdict}`;
  if (result.verdict === 'match') return `${line}\n`;
  return `${line}\nwasm ${result.wasmHash}\n`;
}

/**
 * @param {string} accountId
 */
async function chainCodeHash(accountId) {
  const account = await provider().query({
    request_type: 'view_account',
    finality: 'final',
    account_id: accountId,
  });
  const codeHash = account && typeof account === 'object' ? account.code_hash : '';
  if (typeof codeHash !== 'string' || codeHash.length === 0) throw new Error(`view_account has no code_hash for ${accountId}`);
  return codeHash;
}

/**
 * @param {string[]} argv
 * @param {{ query?: (accountId: string) => Promise<string>, stdout?: (text: string) => void }} [deps]
 * @returns {Promise<'match' | 'drift'>}
 */
export async function verifyCommand(argv, deps = {}) {
  const parsed = parseVerifyArgs(argv);
  const wasmPath = path.resolve(ROOT, parsed.wasm ?? DEFAULT_WASM);
  if (!fs.existsSync(wasmPath)) throw new Error(`wasm not found: ${wasmPath}`);
  const bytes = new Uint8Array(fs.readFileSync(wasmPath));
  if (bytes.byteLength < 4) throw new Error(`wasm is empty: ${wasmPath}`);
  const wasmHash = codeHashOf(bytes);
  const accountId = resolveAccount(parsed.account);
  const onChain = await (deps.query ?? chainCodeHash)(accountId);
  const verdict = compareCodeHash(onChain, wasmHash);
  const shown = path.relative(ROOT, wasmPath) || path.basename(wasmPath);
  const text = formatVerify({ onChain, wasmHash, wasmPath: shown, verdict });
  (deps.stdout ?? ((line) => process.stdout.write(line)))(text);
  return verdict;
}

if (isDirectRun()) {
  verifyCommand(process.argv.slice(2))
    .then((verdict) => {
      process.exit(verdict === 'match' ? 0 : 1);
    })
    .catch((error) => {
      if (error instanceof UsageError) {
        console.error(error.message);
        process.exit(2);
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`verify: ${message}`);
      process.exit(1);
    });
}
