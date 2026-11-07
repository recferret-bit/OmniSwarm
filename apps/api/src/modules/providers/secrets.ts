// Operator provider keys for the production panel. The admin page writes this
// file; the worker reads it when a job starts. The key material is AES-256-GCM
// under SESSION_SECRET. Responses and logs only ever see a fingerprint.
import crypto from 'node:crypto';
import fs from 'node:fs';

export const PROVIDERS = ['zai', 'openrouter'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ProviderView { set: boolean; fingerprint: string | null }
export interface ProviderStatus { zai: ProviderView; openrouter: ProviderView }

interface Sealed { iv: string; tag: string; data: string; fingerprint: string }
interface Store { v: 1; keys: Partial<Record<ProviderName, Sealed>> }

function keyOf(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function fingerprintOf(value: string): string {
  const hex = crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  return `${hex.slice(0, 4)}${hex.slice(-4)}`;
}

function seal(secret: string, value: string): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'), fingerprint: fingerprintOf(value) };
}

function open(secret: string, sealed: Sealed): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
}

function empty(): ProviderStatus {
  return { zai: { set: false, fingerprint: null }, openrouter: { set: false, fingerprint: null } };
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
  const zai = store.keys.zai;
  const openrouter = store.keys.openrouter;
  try {
    if (zai) env.ZAI_API_KEY = open(secret, zai);
  } catch { /* a rotated SESSION_SECRET leaves the old seal unreadable */ }
  try {
    if (openrouter) env.OPENROUTER_API_KEY = open(secret, openrouter);
  } catch { /* same */ }
  return env;
}
