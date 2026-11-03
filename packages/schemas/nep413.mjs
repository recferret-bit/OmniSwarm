// NEP-413 signing payload and base58 (INTAKE section 3). The payload is a u32 LE tag,
// the borsh message, the 32-byte nonce, the borsh recipient and an absent callback.
// The wallet signs sha256(payload). Browser- and Node-safe: no Node imports, Uint8Array
// in and out (a Node Buffer is a Uint8Array and is accepted). No key material lives here.

export const NEP413_TAG = 2147484061;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u32le(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function borshString(value) {
  const body = new TextEncoder().encode(value);
  return concat([u32le(body.length), body]);
}

export function nep413Payload(message, nonce, recipient) {
  if (nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  return concat([u32le(NEP413_TAG), borshString(message), nonce, borshString(recipient), new Uint8Array([0])]);
}

export function b58encode(bytes) {
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

export function b58decode(text) {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros += 1;
  const bytes = [0];
  for (let i = zeros; i < text.length; i++) {
    const value = B58.indexOf(text[i]);
    if (value < 0) throw new Error('invalid base58');
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  while (bytes.length > 1 && bytes[bytes.length - 1] === 0) bytes.pop();
  const out = new Uint8Array(zeros + bytes.length);
  out.set(bytes.reverse(), zeros);
  return out;
}
