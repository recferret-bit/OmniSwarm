// Dev/e2e only. Write side of the intake API: challenge, quote, create, payment,
// health. Responses follow intake-api.schema.json (vitest validates them).
import { requestHash } from '@omniswarm/schemas/canonical-message';
import { http, HttpResponse } from 'msw';
import type { CreateRequestBody, ErrorCode, QuoteRequest } from '@/lib/api/schema.gen';
import { bytesToBase64 } from '@/lib/near/nep413';
import { env } from '@/lib/env';
import { parseRepoInput } from '@/lib/repo';
import { clock, randomBytes, readState, stamp, takeError, updateState, type MockError } from '../db';
import { verifySignature } from '../verify';

export const MOCK_PRICE_YOCTO = '1000000000000000000000000';
export const MOCK_COMMIT = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
const QUOTE_ERRORS: Partial<Record<MockError, [ErrorCode, number, string]>> = {
  QUEUE_FULL: ['QUEUE_FULL', 503, 'The review queue is full'],
  REPO_PRIVATE: ['REPO_PRIVATE', 403, 'Repository is private'],
  REPO_TOO_LARGE: ['REPO_TOO_LARGE', 413, 'Repository is too large'],
  REPO_NOT_FOUND: ['REPO_NOT_FOUND', 404, 'Repository not found'],
  RATE_LIMITED: ['RATE_LIMITED', 429, 'Too many quotes'],
};

export function apiError(code: ErrorCode, status: number, message: string, retryable = false) {
  return HttpResponse.json({ error: { code, message, retryable } }, { status });
}

function uuid(): string {
  const hex = [...randomBytes(16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const challenge = http.post('/api/challenge', () => {
  const nonce = bytesToBase64(randomBytes(32));
  const expiresAt = clock.now() + 5 * 60_000;
  updateState((state) => { state.nonces[nonce] = { expiresAt, used: false }; });
  return HttpResponse.json({ nonce, expiresAt: stamp(expiresAt) });
});

const quote = http.post('/api/quote', async ({ request }) => {
  const body = (await request.json()) as QuoteRequest;
  const injected = readState().controls.error;
  const failure = injected ? QUOTE_ERRORS[injected] : undefined;
  if (failure) return apiError(failure[0], failure[1], failure[2], failure[0] === 'QUEUE_FULL' || failure[0] === 'RATE_LIMITED');
  const parsed = parseRepoInput(body.repoUrl);
  if (!parsed) return apiError('REPO_INVALID', 400, 'Not a GitHub repository');
  if (parsed.repo.startsWith('private/')) return apiError('REPO_PRIVATE', 403, 'Repository is private');
  const queueDepth = readState().requests.filter((row) => row.paidAt !== null).length % 3;
  return HttpResponse.json({
    normalizedRepo: parsed.repo, commitSha: MOCK_COMMIT, priceYocto: MOCK_PRICE_YOCTO,
    contractId: env.contractId, queueDepth, preset: 'scripted', etaMinutes: 15,
  });
});

const create = http.post('/api/requests', async ({ request }) => {
  const body = (await request.json()) as CreateRequestBody;
  const nonce = readState().nonces[body.nonce];
  if (!(await verifySignature({ ...body, recipient: env.intakeRecipient }))) return apiError('SIG_INVALID', 401, 'Signature does not match the message');
  if (takeError('NONCE_EXPIRED')) return apiError('NONCE_EXPIRED', 401, 'This challenge has expired');
  if (!nonce) return apiError('NONCE_UNKNOWN', 401, 'Unknown challenge');
  if (nonce.used) return apiError('NONCE_USED', 409, 'This challenge was already used');
  const message = JSON.parse(body.message) as { account: string; commit: string; repo: string; nonce: string };
  if (message.account !== body.accountId) return apiError('ACCOUNT_MISMATCH', 401, 'Signed account does not match accountId');
  if (message.nonce !== body.nonce) return apiError('SIG_INVALID', 401, 'Signed nonce does not match');
  const hash = await requestHash(body.message);
  const row = {
    id: uuid(), account: body.accountId, repo: message.repo, commit: message.commit, requestHash: hash,
    priceYocto: MOCK_PRICE_YOCTO, createdAt: clock.now(), paidAt: null, txHash: null,
    fails: takeError('REVIEW_FAILED'), attestTx: null, refundTx: null,
  };
  updateState((state) => {
    state.nonces[body.nonce] = { ...nonce, used: true };
    state.requests.unshift(row);
    state.session = body.accountId;
  });
  return HttpResponse.json({ requestId: row.id, requestHash: hash, priceYocto: row.priceYocto, contractId: env.contractId }, { status: 201 });
});

const payment = http.post<{ id: string }>('/api/requests/:id/payment', async ({ params, request }) => {
  const { txHash } = (await request.json()) as { txHash: string };
  const state = readState();
  const row = state.requests.find((item) => item.id === params.id);
  if (!row || row.account !== state.session) return apiError('NOT_FOUND', 404, 'Request not found');
  if (takeError('PAYMENT_NOT_FOUND')) return apiError('PAYMENT_NOT_FOUND', 402, 'Payment transaction was not found', true);
  const tx = state.txs[txHash];
  if (!tx) return apiError('PAYMENT_NOT_FOUND', 402, 'Payment transaction was not found', true);
  if (row.txHash) return apiError('TX_ALREADY_USED', 409, 'This transaction was already used');
  if (tx.receiver !== env.contractId || tx.requestHash !== row.requestHash) return apiError('PAYMENT_MISMATCH', 402, 'Payment does not match this request');
  if (BigInt(tx.deposit) < BigInt(row.priceYocto)) return apiError('PAYMENT_MISMATCH', 402, 'Deposit is below the quoted price');
  const position = state.requests.filter((item) => item.paidAt !== null && item.id !== row.id).length + 1;
  updateState(() => { row.paidAt = clock.now(); row.txHash = txHash; });
  return HttpResponse.json({ status: 'queued', position });
});

const health = http.get('/api/health', () => HttpResponse.json({
  ok: true, network: env.network, queueDepth: readState().requests.filter((row) => row.paidAt !== null).length,
  workers: 1, chain: { rpc: true, contract: true },
}));

export const intakeHandlers = [challenge, quote, create, payment, health];
