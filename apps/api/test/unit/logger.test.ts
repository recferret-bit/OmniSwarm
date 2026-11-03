import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { chainUnavailable } from '../../src/chain/errors.ts';
import { installErrorHandling } from '../../src/http/error-handler.ts';
import { AppError } from '../../src/shared/errors.ts';
import { createLogger } from '../../src/shared/logger.ts';

// Values that must never reach a log line. Built at runtime, so no secret-looking literal is committed.
const planted = (label: string) => `${label}${'Q7'.repeat(8)}`;
const TOKEN = planted('tok');
const RPC_KEY = planted('rpc');
const DB_PASSWORD = planted('pw');

function capture(): { lines: string[]; log: ReturnType<typeof createLogger>; text(): string } {
  const lines: string[] = [];
  const sink = new Writable({ write(chunk, _encoding, done) { lines.push(...String(chunk).split('\n').filter(Boolean)); done(); } });
  const log = createLogger('info', 'test', sink);
  return { lines, log, text: () => lines.join('\n') };
}

async function app(log: FastifyBaseLogger) {
  const server = Fastify({ loggerInstance: log, trustProxy: true });
  installErrorHandling(server);
  server.get('/api/quote', async () => ({ ok: true }));
  server.get('/api/cause', async () => {
    const inner = Object.assign(new Error('github said no'), { token: TOKEN, headers: { authorization: `Bearer ${TOKEN}`, cookie: `sid=${TOKEN}`, 'x-admin-token': TOKEN } });
    throw new AppError('INTERNAL', 'Upstream failed', { cause: new Error('fetch failed', { cause: inner }) });
  });
  server.get('/api/chain', async () => {
    const rpc = Object.assign(new TypeError(`request to https://rpc.provider.example/v2/${RPC_KEY}?apikey=${RPC_KEY} failed`), { url: `https://rpc.provider.example/v2/${RPC_KEY}` });
    throw chainUnavailable(new AggregateError([rpc], `all RPC servers failed: https://u:${RPC_KEY}@rpc2.example/`));
  });
  return server;
}

const parsed = (lines: string[]) => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

test('request logs carry the path without the query string and a truncated client address', async () => {
  const out = capture();
  const server = await app(out.log);
  await server.inject({ method: 'GET', url: `/api/quote?repo=x&token=${TOKEN}`, headers: { 'x-forwarded-for': '203.0.113.77', cookie: `sid=${TOKEN}` } });
  await server.inject({ method: 'GET', url: '/api/quote?a=1', headers: { 'x-forwarded-for': '2001:db8:85a3:8d3:1319:8a2e:370:7348' } });
  await server.inject({ method: 'GET', url: '/api/quote', headers: { 'x-forwarded-for': '::ffff:198.51.100.9' } });
  const requests = parsed(out.lines).filter((row) => row.msg === 'incoming request').map((row) => row.req as Record<string, unknown>);
  assert.deepEqual(requests.map((req) => [req.url, req.remoteAddress]), [
    ['/api/quote', '203.0.113.0'], ['/api/quote', '2001:db8:85a3::'], ['/api/quote', '198.51.100.0'],
  ]);
  assert.ok(requests.every((req) => !('remotePort' in req)));
  assert.equal(out.text().includes(TOKEN), false, out.text());
  assert.equal(out.text().includes('203.0.113.77'), false);
  await server.close();
});

test('an error whose cause chain holds a token, auth headers and a cookie is logged with them redacted', async () => {
  const out = capture();
  const server = await app(out.log);
  const response = await server.inject({ method: 'GET', url: '/api/cause' });
  assert.equal(response.statusCode, 500);
  const text = out.text();
  assert.equal(text.includes(TOKEN), false, text);
  const row = parsed(out.lines).find((entry) => entry.msg === 'Upstream failed');
  const inner = (row?.err as { cause?: Record<string, unknown> } | undefined)?.cause ?? {};
  assert.equal(inner.message, 'github said no', 'the cause chain itself is kept');
  assert.equal(inner.token, '[redacted]');
  assert.deepEqual(inner.headers, { authorization: '[redacted]', cookie: '[redacted]', 'x-admin-token': '[redacted]' });
  await server.close();
});

test('an RPC error with a keyed URL is logged with the URL cut to its origin', async () => {
  const out = capture();
  const server = await app(out.log);
  const response = await server.inject({ method: 'GET', url: '/api/chain' });
  assert.equal(response.statusCode, 503);
  const text = out.text();
  assert.equal(text.includes(RPC_KEY), false, text);
  assert.match(text, /https:\/\/rpc\.provider\.example[^/]/);
  await server.close();
});

test('config, DATABASE_URL-shaped values, secret fields and messages are scrubbed on every log call', () => {
  const out = capture();
  out.log.info({ chain: { rpcUrls: [`https://rpc.provider.example/v2/${RPC_KEY}`] }, db: { url: `postgres://omni:${DB_PASSWORD}@db:5432/omniswarm` }, sessionSecret: TOKEN, apiKey: TOKEN }, 'config loaded');
  out.log.warn(`could not reach postgres://omni:${DB_PASSWORD}@db:5432/omniswarm or https://rpc.provider.example/v2/${RPC_KEY}`);
  out.log.error(new Error(`boom at https://rpc.provider.example/v2/${RPC_KEY}`));
  out.log.error({ err: new Error(`fetch https://rpc.provider.example/v2/${RPC_KEY} failed`) });
  const text = out.text();
  for (const secret of [RPC_KEY, DB_PASSWORD, TOKEN]) assert.equal(text.includes(secret), false, text);
  const [config] = parsed(out.lines);
  assert.deepEqual(config?.chain, { rpcUrls: ['https://rpc.provider.example'] });
  assert.equal(config?.sessionSecret, '[redacted]');
  assert.match(text, /postgres:\/\/\[redacted\]@db:5432/);
});
