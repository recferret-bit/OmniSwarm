// Browser NEP-413 helpers. The payload (u32 tag, borsh message, 32-byte nonce,
// borsh recipient, callback absent) and base58 come from @omniswarm/schemas/nep413,
// the same bytes the intake signer verifies. No key material lives here.
export { b58encode, nep413Payload } from '@omniswarm/schemas/nep413';

export function randomNonce(): { bytes: Uint8Array; base64: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { bytes, base64: btoa(binary) };
}
