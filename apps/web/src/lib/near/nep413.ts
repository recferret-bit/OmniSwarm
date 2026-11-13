// NEP-413 client helpers for the sign-in challenge: the browser-side encodings
// around the nonce the API issues and the signature a wallet returns.

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
