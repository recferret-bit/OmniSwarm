// Pure intake rules: quote URLs, NEP-413 payload, session cookies, rate limit.
// No sockets. HTTP and Postgres stay in app.ts and store.ts.
import crypto from 'node:crypto';
import { canonicalRequestMessage, requestHash } from '@omniswarm/schemas/canonical-message';
import { b58decode as decodeBase58, b58encode, nep413Payload as payloadBytes } from '@omniswarm/schemas/nep413';

export const PRICE_YOCTO = '1000000000000000000000000';

export class AppError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function fail(status: number, code: string, message: string, retryable = false): never {
  throw new AppError(status, code, message, retryable);
}

const FIXTURES: Record<string, { private: boolean; archived: boolean; sizeKb: number; sha: string }> = {
  'near/near-sdk-rs': { private: false, archived: false, sizeKb: 12000, sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' },
  'private/hidden': { private: true, archived: false, sizeKb: 10, sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  'archived/old': { private: false, archived: true, sizeKb: 10, sha: 'cccccccccccccccccccccccccccccccccccccccc' },
  'huge/repo': { private: false, archived: false, sizeKb: 999999999, sha: 'dddddddddddddddddddddddddddddddddddddddd' },
};

export function normalizeRepoUrl(repoUrl: string): { repo: string } {
  const trimmed = String(repoUrl || '').trim();
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) fail(400, 'REPO_INVALID', 'Only https://github.com/<owner>/<repo> URLs are accepted');
  let path = trimmed.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  path = path.replace(/\/tree\/[^/]+$/, '');
  const match = path.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
  if (!match || trimmed.startsWith('git@') || !trimmed.startsWith('https://github.com/')) {
    fail(400, 'REPO_INVALID', 'Repo URL must be https://github.com/<owner>/<repo>');
  }
  return { repo: `${match[1]}/${match[2]}` };
}

export function quoteRepo(repoUrl: string, maxKb: number) {
  const { repo } = normalizeRepoUrl(repoUrl);
  const row = FIXTURES[repo];
  if (!row) fail(404, 'REPO_NOT_FOUND', 'Repository was not found');
  if (row.private) fail(400, 'REPO_PRIVATE', 'Private repositories are not reviewed');
  if (row.archived) fail(400, 'REPO_ARCHIVED', 'Archived repositories are not reviewed');
  if (row.sizeKb > maxKb) fail(400, 'REPO_TOO_LARGE', 'Repository is over the size cap');
  return { normalizedRepo: repo, commitSha: row.sha };
}

// The payload and base58 come from @omniswarm/schemas/nep413 (shared with the browser).
// These wrappers keep the Buffer return type the intake code and its callers use.
export { b58encode };

export function b58decode(text: string): Buffer {
  return Buffer.from(decodeBase58(text));
}

export function nep413Payload(message: string, nonce: Buffer, recipient: string): Buffer {
  return Buffer.from(payloadBytes(message, nonce, recipient));
}

const SPKI = Buffer.from('302a300506032b6570032100', 'hex');

export function publicKeyFromRaw(raw: Buffer) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' });
}

export function rawFromKey(key: crypto.KeyObject, kind: 'public' | 'private'): Buffer {
  const der = key.export(kind === 'public' ? { type: 'spki', format: 'der' } : { type: 'pkcs8', format: 'der' });
  return Buffer.from(der).subarray(-32);
}

export function signNep413(privateKey: crypto.KeyObject, message: string, nonce: Buffer, recipient: string): Buffer {
  const hash = crypto.createHash('sha256').update(nep413Payload(message, nonce, recipient)).digest();
  return crypto.sign(null, hash, privateKey);
}

export function verifyNep413(publicKeyRaw: Buffer, signature: Buffer, message: string, nonce: Buffer, recipient: string): boolean {
  const hash = crypto.createHash('sha256').update(nep413Payload(message, nonce, recipient)).digest();
  return crypto.verify(null, hash, publicKeyFromRaw(publicKeyRaw), signature);
}

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicKey, privateKey, rawPublic: rawFromKey(publicKey, 'public') };
}

export function encodeKey(raw: Buffer): string {
  return `ed25519:${b58encode(raw)}`;
}

export function decodeKey(text: string): Buffer {
  if (!text.startsWith('ed25519:')) throw new Error('expected ed25519 key');
  const raw = b58decode(text.slice('ed25519:'.length));
  if (raw.length !== 32) throw new Error('public key must be 32 bytes');
  return raw;
}

export interface SignedBody {
  accountId: string;
  publicKey: string;
  signature: string;
  message: string;
  nonce: string;
}

export async function buildSignedRequest(input: {
  privateKey: crypto.KeyObject;
  rawPublic: Buffer;
  accountId: string;
  repo: string;
  commit: string;
  nonce: string;
  network?: string;
  preset?: string;
  recipient: string;
}): Promise<SignedBody> {
  const message = canonicalRequestMessage({
    account: input.accountId,
    commit: input.commit,
    deployed: null,
    network: input.network || 'testnet',
    nonce: input.nonce,
    preset: input.preset || 'scripted',
    repo: input.repo,
  });
  const nonce = Buffer.from(input.nonce, 'base64');
  const signature = signNep413(input.privateKey, message, nonce, input.recipient);
  return {
    accountId: input.accountId,
    publicKey: encodeKey(input.rawPublic),
    signature: b58encode(signature),
    message,
    nonce: input.nonce,
  };
}

export { canonicalRequestMessage, requestHash };

export function sessionToken(account: string, secret: string, exp: number): string {
  const body = Buffer.from(JSON.stringify({ account, exp })).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function readSession(token: string, secret: string, now: number): string | null {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { account?: string; exp?: number };
  if (!parsed.account || typeof parsed.exp !== 'number' || parsed.exp < now) return null;
  return parsed.account;
}

export function rateLimit(bucket: Map<string, number[]>, key: string, now: number, limit: number, windowMs: number): boolean {
  const recent = (bucket.get(key) || []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    bucket.set(key, recent);
    return false;
  }
  recent.push(now);
  bucket.set(key, recent);
  return true;
}

export function yoctoLess(left: string, right: string): boolean {
  const a = left.replace(/^0+/, '') || '0';
  const b = right.replace(/^0+/, '') || '0';
  if (a.length !== b.length) return a.length < b.length;
  return a < b;
}
