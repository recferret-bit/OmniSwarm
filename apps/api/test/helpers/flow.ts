// The user's side of the flow over real HTTP: sign in (NEAR wallet, mock key verifier), save the account's
// own NEAR AI key and models, queue a dashboard review. Every response body can be checked against the
// shared JSON Schema.
import assert from 'node:assert/strict';
import { validate } from '@omniswarm/schemas';
import { DevWallet } from '../../scripts/dev-wallet.ts';
import { RECIPIENT } from './stack.ts';

export interface Reply { status: number; body: any; headers: Headers }

export async function call(base: string, path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  const response = await fetch(`${base}${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await response.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: response.status, body, headers: response.headers };
}

/** Assert a body matches packages/schemas/intake-api.schema.json#/$defs/<def>. */
export function conforms(def: string, body: unknown): void {
  const result = validate(`intake-api#${def}`, body);
  assert.ok(result.ok, `${def}: ${result.errors.join('; ')} in ${JSON.stringify(body)}`);
}

export async function challenge(base: string): Promise<string> {
  const reply = await call(base, '/api/challenge', { method: 'POST', body: {} });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  conforms('challenge-response', reply.body);
  return reply.body.nonce;
}

export function sessionCookie(reply: Reply): string {
  const cookie = reply.headers.get('set-cookie')?.split(';')[0];
  if (!cookie?.startsWith('sid=')) assert.fail('sid cookie set');
  return cookie;
}

let counter = 0;
export const freshAccount = () => `user${Date.now().toString(36)}${counter++}.near`;

/** Sign in with a NEAR wallet (challenge, NEP-413 login message). Returns the session cookie. */
export async function signIn(base: string, dev: DevWallet = new DevWallet(freshAccount())): Promise<{ cookie: string; account: string; dev: DevWallet }> {
  const reply = await call(base, '/api/login/near', { method: 'POST', body: dev.login(await challenge(base), RECIPIENT) });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  return { cookie: sessionCookie(reply), account: dev.accountId, dev };
}

export const MODELS = ['deepseek-ai/DeepSeek-V4', 'Qwen/Qwen3.8-Max'];

export async function saveKey(base: string, cookie: string): Promise<void> {
  const saved = await call(base, '/api/account/providers/nearai', { method: 'PUT', cookie, body: { key: 'near-test-key-not-real-0000', models: MODELS } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
}

export interface Queued { requestId: string; cookie: string; account: string }

/** A new account signs in, saves its key and queues a review of the recorded near/near-sdk-rs. */
export async function queuedJob(base: string, body: Record<string, unknown> = {}): Promise<Queued> {
  const { cookie, account } = await signIn(base);
  await saveKey(base, cookie);
  const reply = await call(base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo: 'near/near-sdk-rs', ...body } });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.status, 'queued');
  return { requestId: reply.body.requestId, cookie, account };
}
