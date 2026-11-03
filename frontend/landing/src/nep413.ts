// Browser NEP-413 payload. Same bytes as the intake signer: u32 tag, borsh message,
// 32-byte nonce, borsh recipient, callback absent. No key material lives here.

const TAG = 2147484061;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function borshString(value: string): Uint8Array {
  const body = new TextEncoder().encode(value);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, body.length, true);
  return concat([len, body]);
}

export function nep413Payload(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  if (nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, TAG, true);
  return concat([tag, borshString(message), nonce, borshString(recipient), new Uint8Array([0])]);
}

export function b58encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

export function randomNonce(): { bytes: Uint8Array; base64: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { bytes, base64: btoa(binary) };
}
