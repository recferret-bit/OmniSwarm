import assert from 'node:assert/strict';
import { test } from 'node:test';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { helmetOptions } from '../../src/http/app.ts';

async function headers(cookieSecure: boolean): Promise<Record<string, string | string[] | undefined>> {
  const app = Fastify();
  await app.register(helmet, helmetOptions(cookieSecure));
  app.get('/api/health', async () => ({ ok: true }));
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  await app.close();
  return response.headers;
}

test('the local http stack does not ask the browser to upgrade', async () => {
  const sent = await headers(false);
  assert.equal(sent['strict-transport-security'], undefined);
  assert.doesNotMatch(String(sent['content-security-policy']), /upgrade-insecure-requests/);
});

test('a secure deployment keeps HSTS and upgrades insecure requests', async () => {
  const sent = await headers(true);
  assert.match(String(sent['strict-transport-security']), /max-age=/);
  assert.match(String(sent['content-security-policy']), /upgrade-insecure-requests/);
});
