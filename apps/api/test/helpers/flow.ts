// The user's side of the intake flow over real HTTP: challenge, sign (mock wallet), create, pay on the
// mock chain, confirm. Every response body can be checked against the shared JSON Schema.
import assert from 'node:assert/strict';
import { validate } from '@omniswarm/schemas';
import { payRequestReview, registerKey } from '../../src/chain/mock/mock-ledger.ts';
import type { Db } from '../../src/db/pool.ts';
import { DevWallet, type SignedBody } from '../../scripts/dev-wallet.ts';
import { CONTRACT, PRICE, RECIPIENT, SHA } from './stack.ts';

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

export async function wallet(db: Db, account = 'alice.mock', permission: 'FullAccess' | 'FunctionCall' = 'FullAccess'): Promise<DevWallet> {
  const dev = new DevWallet(account);
  await registerKey(db, dev.accountId, dev.publicKey, permission);
  return dev;
}

export function sign(dev: DevWallet, nonce: string, overrides: Partial<{ repo: string; commit: string; network: string; preset: string; deployed: string | null }> = {}): SignedBody {
  return dev.signRequest({
    repo: 'near/near-sdk-rs', commit: SHA, network: 'testnet', preset: 'scripted', deployed: null, nonce, ...overrides,
  }, RECIPIENT);
}

export function sessionCookie(reply: Reply): string {
  const cookie = reply.headers.get('set-cookie')?.split(';')[0];
  if (!cookie?.startsWith('sid=')) assert.fail('sid cookie set');
  return cookie;
}

export interface Created { requestId: string; requestHash: string; cookie: string }

export async function createRequest(base: string, db: Db, dev?: DevWallet): Promise<Created> {
  const who = dev ?? await wallet(db, `user${Math.floor(Math.random() * 1e9)}.mock`);
  const reply = await call(base, '/api/requests', { method: 'POST', body: sign(who, await challenge(base)) });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  conforms('create-request-response', reply.body);
  return { requestId: reply.body.requestId, requestHash: reply.body.requestHash, cookie: sessionCookie(reply) };
}

export async function pay(db: Db, created: Created, account: string, amount = PRICE): Promise<string> {
  return payRequestReview(db, { signer: account, receiver: CONTRACT, requestHash: created.requestHash, depositYocto: amount });
}

/** challenge -> sign -> create -> pay -> confirm; returns the queued request. */
export async function queuedRequest(base: string, db: Db): Promise<Created & { position: number }> {
  const dev = await wallet(db, `user${Math.floor(Math.random() * 1e9)}.mock`);
  const created = await createRequest(base, db, dev);
  const txHash = await pay(db, created, dev.accountId);
  const reply = await call(base, `/api/requests/${created.requestId}/payment`, { method: 'POST', body: { txHash }, cookie: created.cookie });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  conforms('payment-response', reply.body);
  return { ...created, position: reply.body.position };
}
