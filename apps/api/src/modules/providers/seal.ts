// AES-256-GCM sealing for accounts' own provider keys (account-keys.ts). The key is the sha256 of the
// configured secret; `aad` binds a ciphertext to its owner. Responses and logs only ever see a fingerprint.
import crypto from 'node:crypto';

export interface Sealed { iv: string; tag: string; data: string; fingerprint: string }

function keyOf(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function fingerprintOf(value: string): string {
  const hex = crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  return `${hex.slice(0, 4)}${hex.slice(-4)}`;
}

/** `aad` binds the ciphertext to its owner (a per-account key cannot be moved to another account). */
export function seal(secret: string, value: string, aad?: string): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'), fingerprint: fingerprintOf(value) };
}

export function open(secret: string, sealed: Sealed, aad?: string): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(sealed.iv, 'base64'));
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
}
