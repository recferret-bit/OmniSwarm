// Sandbox RPC. Views take no signer and never read a key file.
import { JsonRpcProvider } from 'near-api-js';

export const RPC_PORT = process.env.NEAR_LOCAL_RPC_PORT || '3030';
export const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
export const NETWORK = 'sandbox';
export const CONTRACT_ID = 'registry.test.near';
export const MASTER_ID = 'test.near';
export const PRICE_YOCTO = '1000000000000000000000000';
export const ONE_NEAR = 1_000_000_000_000_000_000_000_000n;
export const ACCOUNT_BALANCE = 50n * ONE_NEAR;
export const OPERATOR_ALLOWANCE = ONE_NEAR;
export const OPERATOR_METHODS = ['mark_running', 'attest', 'refund', 'report_address'];
export const INIT_GAS = 100_000_000_000_000n;
export const SEEDED_NAMES = ['owner', 'operator', 'treasury', 'alice', 'bob'];

export function accountId(name) {
  return `${name}.test.near`;
}

/** `registry` is registry.test.near. Any other dotless name is `<name>.test.near`. */
export function resolveAccount(arg) {
  if (arg.includes('.')) return arg;
  return accountId(arg);
}

export function provider() {
  return new JsonRpcProvider({ url: RPC_URL }, { retries: 5, wait: 200, backoff: 1.5 });
}

export async function callView(contractId, method, args) {
  const result = await provider().callFunction({
    contractId,
    method,
    args,
    blockQuery: { finality: 'final' },
  });
  return result === undefined ? null : result;
}

export function txHash(result) {
  const hash = result?.transaction?.hash;
  if (typeof hash !== 'string' || hash.length === 0) throw new Error('transaction result has no hash');
  return hash;
}

export function yocto(value) {
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') return String(value);
  return '';
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
