import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { requestHash } from '../../../shared/schemas/canonical-message.mjs';
import {
  AppError, PRICE_YOCTO, b58decode, decodeKey, fail, quoteRepo, rateLimit, readSession, sessionToken, verifyNep413, yoctoLess,
} from './lib.ts';
import * as store from './store.ts';

export interface AppConfig {
  databaseUrl: string;
  sessionSecret: string;
  network?: string;
  recipient?: string;
  contractId?: string;
  priceYocto?: string;
  maxRepoKb?: number;
  preset?: string;
  clock?: { now(): number };
  adminToken?: string;
}

const OPENAPI = {
  openapi: '3.0.3',
  info: { title: 'OmniSwarm intake', version: '0.0.0' },
  paths: {
    '/api/health': { get: { summary: 'Health' } },
    '/api/docs': { get: { summary: 'OpenAPI UI' } },
    '/api/challenge': { post: { summary: 'Issue a NEP-413 nonce' } },
    '/api/quote': { post: { summary: 'Quote a public GitHub repository' } },
    '/api/requests': { post: { summary: 'Create a signed review request' }, get: { summary: 'List the session account' } },
    '/api/requests/{id}': { get: { summary: 'Read one request' } },
    '/api/requests/{id}/payment': { post: { summary: 'Confirm a mock payment' } },
  },
};

function stamp(ms: number) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export async function createApp(config: AppConfig): Promise<FastifyInstance> {
  const pool = store.createPool(config.databaseUrl);
  await store.migrate(pool);
  const clock = config.clock || { now: () => Date.now() };
  const network = config.network || 'testnet';
  const recipient = config.recipient || 'omniswarm.testnet';
  const contractId = config.contractId || 'review-registry.mock';
  const price = config.priceYocto || PRICE_YOCTO;
  const maxRepoKb = config.maxRepoKb ?? 204800;
  const preset = config.preset || 'scripted';
  const challenges = new Map<string, number[]>();
  const adminToken = config.adminToken || 'dev-admin';
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
  app.decorate('pool', pool);
  app.addHook('onClose', async () => { await pool.end(); });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.status).send({ error: { code: error.code, message: error.message, retryable: error.retryable } });
      return;
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) {
      reply.code(413).send({ error: { code: 'VALIDATION_ERROR', message: 'Body is too large', retryable: false } });
      return;
    }
    reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: error.message || 'Invalid request', retryable: false } });
  });

  app.get('/api/health', async () => ({
    ok: true,
    network,
    queueDepth: await store.queueDepth(pool),
    workers: 0,
    chain: { rpc: true, contract: true },
  }));

  app.get('/api/docs', async (_request, reply) => {
    reply.type('text/html').send(`<!DOCTYPE html><html><head><title>OmniSwarm intake API</title></head><body><h1>OpenAPI</h1><pre>${JSON.stringify(OPENAPI, null, 2)}</pre></body></html>`);
  });
  app.get('/api/openapi.json', async () => OPENAPI);

  app.post('/api/challenge', async (request) => {
    const now = clock.now();
    const ip = request.ip || 'unknown';
    if (!rateLimit(challenges, ip, now, 30, 60_000)) fail(429, 'RATE_LIMITED', 'Too many challenges', true);
    const nonce = crypto.randomBytes(32).toString('base64');
    const expires = now + 5 * 60_000;
    await store.issueNonce(pool, nonce, new Date(now), new Date(expires), ip);
    await store.audit(pool, 'api', null, 'challenge_issued', { ip }, new Date(now));
    return { nonce, expiresAt: stamp(expires) };
  });

  app.post('/api/quote', async (request) => {
    const body = request.body as { repoUrl?: string; network?: string };
    if (!body || typeof body.repoUrl !== 'string') fail(400, 'VALIDATION_ERROR', 'repoUrl is required');
    if (body.network === 'mainnet' || network === 'mainnet') fail(400, 'VALIDATION_ERROR', 'Mainnet quoting is disabled');
    const depth = await store.queueDepth(pool);
    if (depth >= 10) fail(503, 'QUEUE_FULL', 'The review queue is full', true);
    const quoted = quoteRepo(body.repoUrl, maxRepoKb);
    return {
      normalizedRepo: quoted.normalizedRepo,
      commitSha: quoted.commitSha,
      priceYocto: price,
      contractId,
      queueDepth: depth,
      preset,
      etaMinutes: 15,
    };
  });

  app.post('/api/requests', async (request, reply) => {
    const body = request.body as { accountId?: string; publicKey?: string; signature?: string; message?: string; nonce?: string };
    if (!body?.accountId || !body.publicKey || !body.signature || !body.message || !body.nonce) {
      fail(400, 'VALIDATION_ERROR', 'accountId, publicKey, signature, message and nonce are required');
    }
    let parsed: { account?: string; commit?: string; repo?: string; nonce?: string; network?: string; preset?: string; v?: number };
    try { parsed = JSON.parse(body.message); } catch { fail(401, 'SIG_INVALID', 'Signature does not match the message'); }
    let raw: Buffer;
    let signature: Buffer;
    let nonceBytes: Buffer;
    try {
      raw = decodeKey(body.publicKey);
      signature = b58decode(body.signature);
      nonceBytes = Buffer.from(body.nonce, 'base64');
    } catch { fail(401, 'SIG_INVALID', 'Signature does not match the message'); }
    if (!verifyNep413(raw, signature, body.message, nonceBytes, recipient)) fail(401, 'SIG_INVALID', 'Signature does not match the message');
    if (parsed.account !== body.accountId) fail(401, 'ACCOUNT_MISMATCH', 'Signed account does not match accountId');
    if (parsed.nonce !== body.nonce) fail(401, 'SIG_INVALID', 'Signed nonce does not match');
    const permission = await store.keyPermission(pool, body.accountId, body.publicKey);
    if (permission !== 'FullAccess') fail(401, 'KEY_NOT_FULL_ACCESS', 'The signing key is not a full-access key');
    const now = new Date(clock.now());
    const consumed = await store.consumeNonce(pool, body.nonce, now);
    if (consumed === 'used') fail(409, 'NONCE_USED', 'This challenge was already used');
    if (consumed === 'expired') fail(401, 'NONCE_EXPIRED', 'This challenge has expired');
    if (consumed === 'missing') fail(401, 'NONCE_UNKNOWN', 'Unknown challenge');
    const quoted = quoteRepo(`https://github.com/${parsed.repo}`, maxRepoKb);
    if (quoted.commitSha !== parsed.commit) fail(409, 'REF_CHANGED', 'The quoted commit changed');
    const hash = await requestHash(body.message);
    const id = crypto.randomUUID();
    await store.insertRequest(pool, {
      id, account: body.accountId, repo: quoted.normalizedRepo, commitSha: quoted.commitSha,
      network: parsed.network || network, preset: parsed.preset || preset, requestHash: hash, priceYocto: price, now,
    });
    const token = sessionToken(body.accountId, config.sessionSecret, clock.now() + 24 * 60 * 60_000);
    reply.header('set-cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
    return reply.code(201).send({ requestId: id, requestHash: hash, priceYocto: price, contractId });
  });

  function accountFrom(request: { headers: { cookie?: string } }) {
    const cookie = String(request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('sid='));
    if (!cookie) fail(401, 'UNAUTHORIZED', 'Sign in required');
    const account = readSession(decodeURIComponent(cookie.slice(4)), config.sessionSecret, clock.now());
    if (!account) fail(401, 'UNAUTHORIZED', 'Sign in required');
    return account;
  }

  app.post('/api/requests/:id/payment', async (request) => {
    const account = accountFrom(request);
    const id = (request.params as { id: string }).id;
    const txHash = (request.body as { txHash?: string })?.txHash;
    if (!txHash) fail(400, 'VALIDATION_ERROR', 'txHash is required');
    const row = await store.getRequest(pool, id);
    if (!row || row.account !== account) fail(404, 'NOT_FOUND', 'Request not found');
    if (await store.paymentExists(pool, txHash)) fail(409, 'TX_ALREADY_USED', 'This transaction was already used');
    const tx = await store.mockTx(pool, txHash);
    if (!tx || tx.success !== true) fail(402, 'PAYMENT_NOT_FOUND', 'Payment transaction was not found');
    if (tx.signer !== account) fail(403, 'FORBIDDEN', 'Payment was signed by another account');
    if (tx.receiver !== contractId || tx.request_hash !== row.request_hash) fail(402, 'PAYMENT_MISMATCH', 'Payment does not match this request');
    const chain = await store.mockRequest(pool, row.request_hash);
    if (!chain || chain.status !== 'Pending' || yoctoLess(String(chain.deposit), String(row.price_yocto))) {
      fail(402, 'PAYMENT_MISMATCH', 'Deposit is below the quoted price');
    }
    const queued = await store.markQueued(pool, id, txHash, String(chain.deposit), account, new Date(clock.now()));
    if (queued === 'used') fail(409, 'TX_ALREADY_USED', 'This transaction was already used');
    if (queued === 'missing') fail(409, 'VALIDATION_ERROR', 'Request is not awaiting payment');
    return { status: 'queued', position: queued.position };
  });

  app.get('/api/requests/:id', async (request) => {
    const row = await store.getRequest(pool, (request.params as { id: string }).id);
    if (!row) fail(404, 'NOT_FOUND', 'Request not found');
    return { status: row.status, createdAt: stamp(new Date(row.created_at).getTime()) };
  });

  app.get('/api/requests', async (request) => {
    const query = request.query as { mine?: string };
    if (query.mine !== '1') fail(400, 'VALIDATION_ERROR', 'mine=1 is required');
    const account = accountFrom(request);
    const rows = await store.listMine(pool, account);
    return {
      requests: rows.map((row) => ({
        requestId: row.id,
        repo: row.repo,
        status: row.status,
        createdAt: stamp(new Date(row.created_at).getTime()),
      })),
    };
  });

  app.post('/api/admin/requests/:id/refund', async (request) => {
    if (request.headers['x-admin-token'] !== adminToken) fail(401, 'UNAUTHORIZED', 'Admin token required');
    const id = (request.params as { id: string }).id;
    const row = await store.getRequest(pool, id);
    if (!row) fail(404, 'NOT_FOUND', 'Request not found');
    if (row.status === 'done' || row.status === 'refunded') fail(409, 'REFUND_NOT_ALLOWED', 'This request cannot be refunded');
    await store.refundOnce(pool, row.request_hash);
    await store.setStatus(pool, id, 'refunded', new Date(clock.now()));
    return { status: 'refunded' };
  });

  return app;
}

export async function reconcile(pool: import('pg').Pool, now = new Date()) {
  const { yoctoLess: less } = await import('./lib.ts');
  const rows = await store.awaitingPayment(pool);
  const moved: string[] = [];
  for (const row of rows) {
    const chain = await store.mockRequest(pool, row.request_hash);
    if (!chain || chain.status !== 'Pending' || less(String(chain.deposit), String(row.price_yocto))) continue;
    const txHash = `reconciled${row.request_hash.slice(0, 32)}`;
    const result = await store.markQueued(pool, row.id, txHash, String(chain.deposit), row.account, now);
    if (typeof result === 'object') {
      await store.audit(pool, 'reconcile', row.id, 'reconciled', {}, now);
      moved.push(row.id);
    }
  }
  return moved;
}
