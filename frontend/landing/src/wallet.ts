import { canonicalRequestMessage, requestHash } from '@omniswarm/schemas/canonical-message';
import { randomNonce } from './nep413.ts';

export const INTAKE_RECIPIENT = 'omniswarm.testnet';

async function loadWallet() {
  if (import.meta.env.DEV) return import('./mock-wallet.ts');
  throw new Error('wallet connector is not bundled');
}

export async function connectAccount(): Promise<string> {
  const wallet = await loadWallet();
  return wallet.getAccount();
}

export async function signQuote(input: { account: string; repo: string; commit: string }) {
  const wallet = await loadWallet();
  const nonce = randomNonce();
  const message = canonicalRequestMessage({
    account: input.account,
    commit: input.commit,
    deployed: null,
    network: 'testnet',
    nonce: nonce.base64,
    preset: 'scripted',
    repo: input.repo,
  });
  const signed = await wallet.signMessage({ message, nonce: nonce.bytes, recipient: INTAKE_RECIPIENT });
  return {
    message,
    nonce: nonce.base64,
    signature: signed.signature,
    publicKey: signed.publicKey,
    requestHash: await requestHash(message),
    recipient: INTAKE_RECIPIENT,
  };
}

export async function payQuote(reject: boolean) {
  const wallet = await loadWallet();
  return wallet.signAndSendTransaction({ reject });
}
