import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../backend/intake/src/app.ts';
import { createPool, reset } from '../../backend/intake/src/store.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INTAKE = path.join(ROOT, 'backend/intake');
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://omniswarm:omniswarm@127.0.0.1:55432/omniswarm';
const SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

function run(script: string, args: string[]) {
  return spawnSync(process.execPath, [path.join(INTAKE, script), ...args], {
    cwd: INTAKE,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL, INTAKE_RECIPIENT: 'omniswarm.testnet', CONTRACT_ID: 'review-registry.mock' },
  });
}

test('challenge, quote, NEP-413 pay, rejections and reconcile', async () => {
  const clock = { ms: Date.now(), now() { return this.ms; } };
  const app = await createApp({ databaseUrl: DATABASE_URL, sessionSecret: 'test-session-secret', clock });
  const pool = createPool(DATABASE_URL);
  let limitedApp: Awaited<ReturnType<typeof createApp>> | null = null;
  try {
  await reset(pool);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const base = address;

  async function send(url: string, options: RequestInit = {}) {
    const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }

  const health = await send(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  const docs = await fetch(`${base}/api/docs`);
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /OpenAPI/);

  const quote = await send(`${base}/api/quote`, { method: 'POST', body: JSON.stringify({ repoUrl: 'https://github.com/near/near-sdk-rs', network: 'testnet' }) });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.normalizedRepo, 'near/near-sdk-rs');
  assert.equal(quote.body.commitSha, SHA);
  assert.equal(quote.body.priceYocto, '1000000000000000000000000');
  for (const [url, code] of [
    ['https://github.com/private/hidden', 'REPO_PRIVATE'],
    ['https://github.com/archived/old', 'REPO_ARCHIVED'],
    ['https://github.com/huge/repo', 'REPO_TOO_LARGE'],
  ] as const) {
    const rejected = await send(`${base}/api/quote`, { method: 'POST', body: JSON.stringify({ repoUrl: url, network: 'testnet' }) });
    assert.equal(rejected.body.error.code, code, url);
  }

  async function challenge() {
    const response = await send(`${base}/api/challenge`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body.nonce as string;
  }

  async function sign(nonce: string, permission = 'FullAccess') {
    const result = run('scripts/sign-request.ts', ['--account', 'alice.mock', '--repo', 'near/near-sdk-rs', '--commit', SHA, '--nonce', nonce, '--permission', permission]);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }

  const nonce = await challenge();
  const signed = await sign(nonce);
  const created = await send(`${base}/api/requests`, { method: 'POST', body: JSON.stringify(signed) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cookie = created.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('sid='));
  const replay = await send(`${base}/api/requests`, { method: 'POST', body: JSON.stringify(signed) });
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error.code, 'NONCE_USED');

  const fresh = await sign(await challenge());
  fresh.message = fresh.message.replace('scripted', 'scripteX');
  const tamper = await send(`${base}/api/requests`, { method: 'POST', body: JSON.stringify(fresh) });
  assert.equal(tamper.status, 401);
  assert.equal(tamper.body.error.code, 'SIG_INVALID');

  const limited = await sign(await challenge(), 'FunctionCall');
  const fnKey = await send(`${base}/api/requests`, { method: 'POST', body: JSON.stringify(limited) });
  assert.equal(fnKey.status, 401);
  assert.equal(fnKey.body.error.code, 'KEY_NOT_FULL_ACCESS');

  const expiring = await sign(await challenge());
  clock.ms += 6 * 60_000;
  const expired = await send(`${base}/api/requests`, { method: 'POST', body: JSON.stringify(expiring) });
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'NONCE_EXPIRED');
  clock.ms -= 6 * 60_000;

  const paid = run('scripts/mock-pay.ts', [created.body.requestId]);
  assert.equal(paid.status, 0, paid.stderr);
  const tx = JSON.parse(paid.stdout);
  const confirmed = await send(`${base}/api/requests/${created.body.requestId}/payment`, {
    method: 'POST', body: JSON.stringify({ txHash: tx.txHash }), headers: { cookie: cookie! },
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, 'queued');
  assert.equal(confirmed.body.position, 1);
  const view = await send(`${base}/api/requests/${created.body.requestId}`);
  assert.equal(view.body.status, 'queued');
  const mine = await send(`${base}/api/requests?mine=1`, { headers: { cookie: cookie! } });
  assert.equal(mine.body.requests.length, 1);
  const anon = await send(`${base}/api/requests?mine=1`);
  assert.equal(anon.status, 401);

  const secondNonce = await challenge();
  const second = await sign(secondNonce);
  const secondCreated = await send(`${base}/api/requests`, { method: 'POST', body: JSON.stringify(second) });
  assert.equal(secondCreated.status, 201, JSON.stringify(secondCreated.body));
  const secondCookie = secondCreated.headers.get('set-cookie')?.split(';')[0];
  const reused = await send(`${base}/api/requests/${secondCreated.body.requestId}/payment`, {
    method: 'POST', body: JSON.stringify({ txHash: tx.txHash }), headers: { cookie: secondCookie! },
  });
  assert.equal(reused.status, 409);
  assert.equal(reused.body.error.code, 'TX_ALREADY_USED');

  const third = await send(`${base}/api/requests`, { method: 'POST', body: JSON.stringify(await sign(await challenge())) });
  const under = run('scripts/mock-pay.ts', [third.body.requestId, '--amount', '1']);
  assert.equal(under.status, 0, under.stderr);
  const underTx = JSON.parse(under.stdout);
  const underPay = await send(`${base}/api/requests/${third.body.requestId}/payment`, {
    method: 'POST', body: JSON.stringify({ txHash: underTx.txHash }), headers: { cookie: third.headers.get('set-cookie')!.split(';')[0] },
  });
  assert.equal(underPay.status, 402);
  assert.equal(underPay.body.error.code, 'PAYMENT_MISMATCH');

  const fourth = await send(`${base}/api/requests`, { method: 'POST', body: JSON.stringify(await sign(await challenge())) });
  const parked = run('scripts/mock-pay.ts', [fourth.body.requestId]);
  assert.equal(parked.status, 0, parked.stderr);
  const reconciled = run('scripts/reconcile.ts', []);
  assert.equal(reconciled.status, 0, reconciled.stderr);
  assert.match(reconciled.stdout, new RegExp(fourth.body.requestId));
  const after = await send(`${base}/api/requests/${fourth.body.requestId}`);
  assert.equal(after.body.status, 'queued');

  limitedApp = await createApp({ databaseUrl: DATABASE_URL, sessionSecret: 'test-session-secret', clock });
  const limitedBase = await limitedApp.listen({ port: 0, host: '127.0.0.1' });
  for (let i = 0; i < 30; i++) {
    const response = await send(`${limitedBase}/api/challenge`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 200, `challenge ${i}`);
  }
  const blocked = await send(`${limitedBase}/api/challenge`, { method: 'POST', body: '{}' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');

  } finally {
    await limitedApp?.close();
    await app.close();
    await pool.end();
  }
});
