// Dev/e2e only. The mock intake verifies NEP-413 signatures the way the real one
// does (sha256 of the payload, ed25519, base64 signature), so a client encoding
// bug fails under mocks too instead of first failing against the real API.
import { b58decode, nep413Payload } from '@omniswarm/schemas/nep413';
import { base64ToBytes, decodeChallengeNonce } from '@/lib/near/nep413';

export async function verifySignature(input: { publicKey: string; signature: string; message: string; nonce: string; recipient: string }): Promise<boolean> {
  try {
    const raw = b58decode(input.publicKey.replace(/^ed25519:/, ''));
    const key = await crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'Ed25519' }, false, ['verify']);
    const digest = await crypto.subtle.digest('SHA-256', nep413Payload(input.message, decodeChallengeNonce(input.nonce), input.recipient));
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, new Uint8Array(base64ToBytes(input.signature)), digest);
  } catch {
    return false;
  }
}
