// Sandbox dashboard payment. The seeded bob key is a funded full-access key.
// The file is opened only when the intake network is sandbox; testnet and mainnet never touch it.
import path from 'node:path';
import { Account, actions } from 'near-api-js';
import { ChainRejectedError, chainUnavailable } from '../../chain/errors.ts';
import { createProvider } from '../../chain/near/near-chain.ts';
import { loadOperatorKey, type OperatorKey } from '../../chain/near/operator-key.ts';
import { panicReason } from '../../chain/near/payment-tx.ts';
import { fail } from '../../shared/errors.ts';
import { REPO_ROOT } from '../../shared/paths.ts';

const GAS = 30_000_000_000_000n;
const YOCTO = /^(0|[1-9][0-9]{0,38})$/;
const REQUEST_HASH = /^[0-9a-f]{64}$/;

export const SANDBOX_PAYER_ACCOUNT = 'bob.test.near';

export function sandboxPayerKeyPath(): string {
  const fromEnv = process.env.SANDBOX_PAYER_KEY_FILE?.trim();
  if (fromEnv) return fromEnv;
  return path.join(REPO_ROOT, 'infra/compose/.local/near/keys/bob.json');
}

/** Signer for the seeded bob account. Does not read `keyPath` unless `network` is sandbox. */
export function loadFundedDevKey(network: string, keyPath: string): OperatorKey & { accountId: string } {
  if (network !== 'sandbox') fail('FORBIDDEN', 'A funded dev key is loaded only when the network is sandbox');
  const key = loadOperatorKey(keyPath);
  if (key.accountId !== SANDBOX_PAYER_ACCOUNT) throw new Error(`sandbox dashboard payer must be ${SANDBOX_PAYER_ACCOUNT}`);
  return { accountId: key.accountId, signer: key.signer };
}

export interface SandboxReviewPayment {
  network: string;
  rpcUrls: readonly string[];
  contractId: string;
  requestHash: string;
  depositYocto: string;
  keyPath?: string;
}

/** `request_review` on the sandbox registry, deposit = the configured price, signed by bob. */
export async function requestReviewOnSandbox(input: SandboxReviewPayment): Promise<{ txHash: string; signerId: string }> {
  const key = loadFundedDevKey(input.network, input.keyPath ?? sandboxPayerKeyPath());
  if (!input.contractId) fail('VALIDATION_ERROR', 'Sandbox contract id is not configured');
  const rpcUrls = input.rpcUrls.filter((url) => url.length > 0);
  if (rpcUrls.length === 0) fail('CHAIN_UNAVAILABLE', 'Sandbox RPC is not configured');
  if (!REQUEST_HASH.test(input.requestHash)) fail('VALIDATION_ERROR', 'Request hash must be 64 lowercase hex characters');
  if (!YOCTO.test(input.depositYocto) || input.depositYocto === '0') fail('NETWORK_DISABLED', 'Sandbox review price is not configured');
  const account = new Account(key.accountId, createProvider(rpcUrls), key.signer);
  let response: unknown;
  try {
    response = await account.signAndSendTransaction({
      receiverId: input.contractId,
      actions: [actions.functionCall('request_review', { request_hash: input.requestHash }, GAS, BigInt(input.depositYocto))],
      waitUntil: 'FINAL',
      throwOnFailure: false,
    });
  } catch (error) {
    throw chainUnavailable(error);
  }
  const reason = panicReason(response);
  if (reason) throw new ChainRejectedError(reason);
  const txHash = String((response as { transaction?: { hash?: string } }).transaction?.hash ?? '');
  if (!txHash) throw chainUnavailable(new Error('request_review returned no transaction hash'));
  return { txHash, signerId: key.accountId };
}
