// NEP-413 client helpers. The payload bytes, base58 and the canonical request
// message all come from @omniswarm/schemas, the same module the intake verifies
// with; this file only handles the browser-side encodings around them.
import { canonicalRequestMessage, requestHash } from '@omniswarm/schemas/canonical-message';
import type { Network } from '../api/schema.gen';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

// The nonce is always the one `POST /api/challenge` issued: 32 bytes, base64.
export function decodeChallengeNonce(nonce: string): Uint8Array {
  const bytes = base64ToBytes(nonce);
  if (bytes.length !== 32) throw new Error('challenge nonce must decode to 32 bytes');
  return bytes;
}

export interface RequestFields {
  account: string;
  commit: string;
  deployed: string | null;
  network: Network;
  nonce: string;
  preset: string;
  repo: string;
}

export async function buildSignedRequest(fields: RequestFields): Promise<{ message: string; requestHash: string; nonceBytes: Uint8Array }> {
  const message = canonicalRequestMessage(fields);
  return { message, requestHash: await requestHash(message), nonceBytes: decodeChallengeNonce(fields.nonce) };
}
