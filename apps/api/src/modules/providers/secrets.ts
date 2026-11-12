// Operator provider keys for the hosted panel, one per provider whose catalog entry has keySources
// 'admin-page' (packages/schemas/providers.mjs; today Z.AI and OpenRouter). The admin page writes this
// file; the worker reads it when a job starts. The key material is AES-256-GCM under SESSION_SECRET.
// Responses and logs only ever see a fingerprint.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { adminProviders } from '@omniswarm/schemas/providers';

export const PROVIDERS: readonly string[] = adminProviders().map((provider) => provider.id);
export type ProviderName = string;

export interface ProviderView { set: boolean; fingerprint: string | null }
export type ProviderStatus = Record<string, ProviderView>;

export interface Sealed { iv: string; tag: string; data: string; fingerprint: string }
interface Store { v: 1; keys: Partial<Record<ProviderName, Sealed>> }

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

function empty(): ProviderStatus {
  return Object.fromEntries(PROVIDERS.map((name) => [name, { set: false, fingerprint: null }]));
}

function readStore(file: string): Store {
  if (!file || !fs.existsSync(file)) return { v: 1, keys: {} };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Store;
  if (parsed.v !== 1 || !parsed.keys) return { v: 1, keys: {} };
  return parsed;
}

export function providerStatus(file: string): ProviderStatus {
  const store = readStore(file);
  const status = empty();
  for (const name of PROVIDERS) {
    const sealed = store.keys[name];
    if (sealed?.fingerprint) status[name] = { set: true, fingerprint: sealed.fingerprint };
  }
  return status;
}

/** Replace the named keys. An empty string clears that key. Omitted names stay. */
export function writeProviderSecrets(file: string, secret: string, updates: Partial<Record<ProviderName, string>>): ProviderStatus {
  if (secret.length < 32) throw new Error('SESSION_SECRET is required to store provider keys');
  const store = readStore(file);
  for (const name of PROVIDERS) {
    if (!(name in updates)) continue;
    const value = updates[name] ?? '';
    if (value === '') delete store.keys[name];
    else store.keys[name] = seal(secret, value);
  }
  const dir = file.slice(0, file.lastIndexOf('/'));
  if (dir) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  // 0644: the API container and the host workers are different users on the local stack.
  fs.writeFileSync(tmp, `${JSON.stringify(store)}\n`, { mode: 0o644 });
  fs.renameSync(tmp, file);
  return providerStatus(file);
}

/** Decrypted keys for one engine spawn. Missing file or a bad seal yields whatever is still readable. */
export function readProviderEnv(file: string, secret: string): Record<string, string> {
  if (!file || !secret || secret.length < 32) return {};
  const store = readStore(file);
  const env: Record<string, string> = {};
  for (const provider of adminProviders()) {
    const sealed = store.keys[provider.id];
    if (!sealed || !provider.keyEnv) continue;
    try {
      env[provider.keyEnv] = open(secret, sealed);
    } catch { /* a rotated SESSION_SECRET leaves the old seal unreadable */ }
  }
  return env;
}
