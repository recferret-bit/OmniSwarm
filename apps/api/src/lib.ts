// Compatibility re-exports for tests/e2e/landing/flow.test.mjs (track F), which imports these names
// from this path. Delete once that test imports src/modules/auth/nep413.ts directly.
import { b58decode as decodeBase58 } from '@omniswarm/schemas/nep413';
import { decodePublicKey, verifyNep413 } from './modules/auth/nep413.ts';

export { verifyNep413 };

export function b58decode(text: string): Buffer {
  return Buffer.from(decodeBase58(text));
}

export function decodeKey(text: string): Buffer {
  const key = decodePublicKey(text);
  if (!key) throw new Error('expected an ed25519:<base58> public key');
  return key;
}
