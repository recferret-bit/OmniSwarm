// Dev-only connector. The production bundle guard reads this file and fails
// if either token below shows up in dist/. Vite includes this module only when
// import.meta.env.DEV is true.
import { b58encode, nep413Payload } from './nep413.ts';

export const connectorName = 'MockConnector';

const ACCOUNT = 'alice.testnet';
let keyPair: CryptoKeyPair | null = null;

async function keys(): Promise<CryptoKeyPair> {
  if (!keyPair) keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return keyPair;
}

async function rawPublic(): Promise<Uint8Array> {
  const pair = await keys();
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return spki.slice(-32);
}

export function formatPublicKey(raw: Uint8Array): string {
  return `ed25519:${b58encode(raw)}`;
}

export async function getAccount(): Promise<string> {
  return ACCOUNT;
}

export async function signMessage(input: { message: string; nonce: Uint8Array; recipient: string }): Promise<{ signature: string; publicKey: string }> {
  const pair = await keys();
  const payload = nep413Payload(input.message, input.nonce, input.recipient);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, hash));
  if (signature.length !== 64) throw new Error(`signature length ${signature.length}`);
  return { signature: b58encode(signature), publicKey: formatPublicKey(await rawPublic()) };
}

export async function signAndSendTransaction(input: { reject?: boolean }): Promise<{ txHash: string }> {
  if (input.reject) {
    const error = new Error('UserRejected');
    error.name = 'UserRejected';
    throw error;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return { txHash: `mock:${b58encode(bytes)}` };
}
