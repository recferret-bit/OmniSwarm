// NEP-413 signature check over the shared payload builder (@omniswarm/schemas/nep413): the wallet
// signs sha256(tag || borsh(message) || nonce[32] || borsh(recipient) || None). The FullAccess check
// is the key verifier's (AccountKeyVerifier.keyPermission); this module is pure crypto.
import crypto from 'node:crypto';
import { b58decode, b58encode, nep413Payload } from '@omniswarm/schemas/nep413';

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const BASE64 = /^[A-Za-z0-9+/]{86}==$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

/** `ed25519:<base58 32 bytes>` -> raw key, or null. */
export function decodePublicKey(text: string): Buffer | null {
  const match = /^ed25519:([1-9A-HJ-NP-Za-km-z]{32,64})$/.exec(text);
  if (!match?.[1]) return null;
  const raw = Buffer.from(b58decode(match[1]));
  return raw.length === 32 ? raw : null;
}

export function encodePublicKey(raw: Uint8Array): string {
  return `ed25519:${b58encode(raw)}`;
}

/**
 * Wallets return the NEP-413 signature as base64 (the spec). Plain or `ed25519:`-prefixed base58 is
 * accepted for wallets that follow the older near-api-js encoding. Returns 64 bytes or null.
 */
export function decodeSignature(text: string): Buffer | null {
  const bare = text.startsWith('ed25519:') ? text.slice('ed25519:'.length) : text;
  let bytes: Buffer | null = null;
  if (BASE64.test(bare)) bytes = Buffer.from(bare, 'base64');
  else if (BASE58.test(bare)) bytes = Buffer.from(b58decode(bare));
  return bytes?.length === 64 ? bytes : null;
}

function digest(message: string, nonce: Uint8Array, recipient: string): Buffer {
  return crypto.createHash('sha256').update(nep413Payload(message, nonce, recipient)).digest();
}

export function verifyNep413(publicKey: Buffer, signature: Buffer, message: string, nonce: Uint8Array, recipient: string): boolean {
  if (nonce.length !== 32) return false;
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, publicKey]), format: 'der', type: 'spki' });
  return crypto.verify(null, digest(message, nonce, recipient), key, signature);
}

/** The wallet side, for dev scripts and tests. Returns a base64 signature as wallets do. */
export function signNep413(privateKey: crypto.KeyObject, message: string, nonce: Uint8Array, recipient: string): string {
  return crypto.sign(null, digest(message, nonce, recipient), privateKey).toString('base64');
}

export function rawPublicKey(key: crypto.KeyObject): Buffer {
  return Buffer.from(key.export({ type: 'spki', format: 'der' })).subarray(-32);
}
