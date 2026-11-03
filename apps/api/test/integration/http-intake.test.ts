// W08 over real HTTP on a fresh database: challenge, quote, signed request (and every rejection),
// session, payment (and every rejection), reads, error shapes. Responses are checked against
// packages/schemas/intake-api.schema.json.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { payRequestReview, seedAttestation, setCodeHash } from '../../src/chain/mock/mock-ledger.ts';
import { transition } from '../../src/db/repositories/requests.ts';
import { call, challenge, conforms, createRequest, pay, sessionCookie, sign, wallet } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { CONTRACT, PRICE, SHA, TestClock, migratedDb, startApi, type ApiStack, type TestDb } from '../helpers/stack.ts';

describe('intake HTTP API', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  const clock = new TestClock();
  before(async () => {
    t = await migratedDb('http');
    api = await startApi(t.env, clock);
  });
  after(async () => {
    await api?.close();
    await t?.db.drop();
  });

  test('health, readiness and docs', async () => {
    const health = await call(api.base, '/api/health');
    assert.equal(health.status, 200);
    conforms('health-response', health.body);
    assert.deepEqual(health.body.chain, { rpc: true, contract: true });
    const ready = await call(api.base, '/api/ready');
    assert.equal(ready.status, 200);
    conforms('ready-response', ready.body);
    const docs = await call(api.base, '/api/docs/json');
    assert.equal(docs.status, 200);
    for (const path of ['/api/challenge', '/api/quote', '/api/requests', '/api/requests/{id}/payment', '/api/requests/{id}/events']) {
      assert.ok(docs.body.paths[path], `OpenAPI lists ${path}`);
    }
    assert.ok(!docs.body.paths['/api/admin/requests/{id}/refund'], 'admin route is not on the public app');
  });

  test('challenge nonces are 44-char base64 and expire in five minutes', async () => {
    const first = await call(api.base, '/api/challenge', { method: 'POST', body: {} });
    const second = await call(api.base, '/api/challenge', { method: 'POST' });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.notEqual(first.body.nonce, second.body.nonce);
    assert.equal(first.body.nonce.length, 44);
    const row = await api.deps.pool.query('SELECT expires_at - created_at AS ttl FROM nonce WHERE nonce = $1', [first.body.nonce]);
    assert.equal(row.rows[0].ttl.minutes, 5);
  });

  test('quote normalizes, resolves refs and maps GitHub rejections', async () => {
    const quote = await call(api.base, '/api/quote', { method: 'POST', body: { repoUrl: 'https://github.com/near/near-sdk-rs/tree/master', network: 'testnet' } });
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    conforms('quote-response', quote.body);
    assert.equal(quote.body.normalizedRepo, 'near/near-sdk-rs');
    assert.equal(quote.body.commitSha, SHA);
    assert.equal(quote.body.priceYocto, PRICE);
    assert.equal(quote.body.preset, 'scripted');
    const tag = await call(api.base, '/api/quote', { method: 'POST', body: { repoUrl: 'https://github.com/near/near-sdk-rs@v5.30.0', network: 'testnet' } });
    assert.equal(tag.body.commitSha, 'a'.repeat(40));
    for (const [repoUrl, code, status] of [
      ['https://github.com/private/hidden', 'REPO_PRIVATE', 400], ['https://github.com/archived/old', 'REPO_ARCHIVED', 400],
      ['https://github.com/huge/repo', 'REPO_TOO_LARGE', 400], ['https://github.com/torvalds/linux', 'REPO_NOT_FOUND', 404],
      ['https://github.com/near/near-sdk-rs/tree/nope', 'REF_NOT_FOUND', 404], ['git@github.com:near/near-sdk-rs', 'REPO_INVALID', 400],
    ] as const) {
      const reply = await call(api.base, '/api/quote', { method: 'POST', body: { repoUrl, network: 'testnet' } });
      assert.equal(reply.body.error?.code, code, repoUrl);
      assert.equal(reply.status, status, repoUrl);
      conforms('error-response', reply.body);
    }
    const mainnet = await call(api.base, '/api/quote', { method: 'POST', body: { repoUrl: 'https://github.com/near/near-sdk-rs', network: 'mainnet' } });
    assert.equal(mainnet.body.error.code, 'NETWORK_DISABLED');
  });

  test('a signed request is created once and sets an httpOnly session', async () => {
    const dev = await wallet(api.deps.pool, 'alice.mock');
    const body = sign(dev, await challenge(api.base));
    const created = await call(api.base, '/api/requests', { method: 'POST', body });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    conforms('create-request-response', created.body);
    assert.match(created.headers.get('set-cookie') ?? '', /sid=.*HttpOnly.*SameSite=Lax/i);
    const replay = await call(api.base, '/api/requests', { method: 'POST', body });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error.code, 'NONCE_USED');
    const events = await api.deps.pool.query(`SELECT event, data::text FROM audit_log WHERE request_id = $1`, [created.body.requestId]);
    assert.deepEqual(events.rows.map((row) => row.event), ['request_created']);
    const all = await api.deps.pool.query(`SELECT data::text AS data FROM audit_log`);
    for (const row of all.rows) assert.ok(!row.data.includes(body.signature) && !row.data.includes(body.publicKey), 'no signature or key in audit_log');
  });

  test('signature, key, nonce and canonical-message rejections', async () => {
    const dev = await wallet(api.deps.pool, 'bob.mock');
    const tampered = sign(dev, await challenge(api.base));
    tampered.message = tampered.message.replace('scripted', 'scriptex');
    let reply = await call(api.base, '/api/requests', { method: 'POST', body: tampered });
    assert.equal(reply.body.error.code, 'PRESET_NOT_ALLOWED');
    const badSig = sign(dev, await challenge(api.base));
    badSig.signature = sign(dev, await challenge(api.base)).signature;
    reply = await call(api.base, '/api/requests', { method: 'POST', body: badSig });
    assert.equal(reply.status, 401);
    assert.equal(reply.body.error.code, 'SIG_INVALID');
    const fnKey = await wallet(api.deps.pool, 'carol.mock', 'FunctionCall');
    reply = await call(api.base, '/api/requests', { method: 'POST', body: sign(fnKey, await challenge(api.base)) });
    assert.equal(reply.body.error.code, 'KEY_NOT_FULL_ACCESS');
    const unknownKey = (await import('../../scripts/dev-wallet.ts')).DevWallet;
    reply = await call(api.base, '/api/requests', { method: 'POST', body: sign(new unknownKey('dave.mock'), await challenge(api.base)) });
    assert.equal(reply.body.error.code, 'KEY_NOT_FULL_ACCESS');
    const expiring = sign(dev, await challenge(api.base));
    clock.advance(6 * 60_000);
    reply = await call(api.base, '/api/requests', { method: 'POST', body: expiring });
    clock.advance(-6 * 60_000);
    assert.equal(reply.body.error.code, 'NONCE_EXPIRED');
    const invented = sign(dev, Buffer.alloc(32, 7).toString('base64'));
    reply = await call(api.base, '/api/requests', { method: 'POST', body: invented });
    assert.equal(reply.body.error.code, 'NONCE_UNKNOWN');
    const failures = await api.deps.pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE event = 'verify_failed'`);
    assert.ok(failures.rows[0].n >= 5);
  });

  test('the signed message must be exactly the canonical message with allowed fields', async () => {
    const dev = await wallet(api.deps.pool, 'erin.mock');
    const nonce = await challenge(api.base);
    const canonical = JSON.parse(sign(dev, nonce).message);
    const cases: Array<[string, string]> = [
      [JSON.stringify({ ...canonical, extra: 'x' }), 'MESSAGE_INVALID'],
      [JSON.stringify(canonical, null, 1), 'MESSAGE_INVALID'],
      [JSON.stringify(Object.fromEntries(Object.entries(canonical).reverse())), 'MESSAGE_INVALID'],
      ['not json', 'MESSAGE_INVALID'],
    ];
    for (const [message, code] of cases) {
      const reply = await call(api.base, '/api/requests', { method: 'POST', body: dev.signMessage(message, nonce, 'omniswarm.testnet') });
      assert.equal(reply.body.error?.code, code, message);
    }
    const mainnet = await call(api.base, '/api/requests', { method: 'POST', body: sign(dev, nonce, { network: 'mainnet' }) });
    assert.equal(mainnet.body.error.code, 'NETWORK_DISABLED');
    const cli = await call(api.base, '/api/requests', { method: 'POST', body: dev.signMessage(
      JSON.stringify({ ...canonical, preset: 'cli:claude:opus --rpc' }), nonce, 'omniswarm.testnet') });
    assert.equal(cli.body.error.code, 'MESSAGE_INVALID');
    const otherPreset = await call(api.base, '/api/requests', { method: 'POST', body: sign(dev, nonce, { preset: 'hosted' }) });
    assert.equal(otherPreset.body.error.code, 'PRESET_NOT_ALLOWED');
    const otherAccount = sign(dev, nonce);
    otherAccount.accountId = 'mallory.mock';
    const mismatch = await call(api.base, '/api/requests', { method: 'POST', body: otherAccount });
    assert.equal(mismatch.body.error.code, 'ACCOUNT_MISMATCH');
    const changed = await call(api.base, '/api/requests', { method: 'POST', body: sign(dev, nonce, { commit: 'f'.repeat(40) }) });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'REF_CHANGED');
    const accepted = await call(api.base, '/api/requests', { method: 'POST', body: sign(dev, nonce) });
    assert.equal(accepted.status, 201, 'the nonce survives rejected attempts');
  });

  test('NEP-413 base58 signatures are accepted for compatibility', async () => {
    const dev = await wallet(api.deps.pool, 'frank.mock');
    const body = sign(dev, await challenge(api.base));
    const { b58encode } = await import('@omniswarm/schemas/nep413');
    body.signature = b58encode(Buffer.from(body.signature, 'base64'));
    const reply = await call(api.base, '/api/requests', { method: 'POST', body });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
  });

  test('payment: queued once, and every mismatch has its code', async () => {
    const dev = await wallet(api.deps.pool, 'gina.mock');
    const created = await createRequest(api.base, api.deps.pool, dev);
    const pending = await call(api.base, `/api/requests/${created.requestId}/payment`, { method: 'POST', body: { txHash: '1'.repeat(44) }, cookie: created.cookie });
    assert.equal(pending.body.error.code, 'PAYMENT_NOT_FOUND');
    const stranger = await payRequestReview(api.deps.pool, { signer: 'mallory.mock', receiver: CONTRACT, requestHash: '9'.repeat(64), depositYocto: PRICE });
    const signer = await call(api.base, `/api/requests/${created.requestId}/payment`, { method: 'POST', body: { txHash: stranger }, cookie: created.cookie });
    assert.equal(signer.status, 403);
    assert.equal(signer.body.error.code, 'PAYMENT_SIGNER_MISMATCH');
    const noCookie = await call(api.base, `/api/requests/${created.requestId}/payment`, { method: 'POST', body: { txHash: stranger } });
    assert.equal(noCookie.status, 401);
    const txHash = await pay(api.deps.pool, created, dev.accountId);
    const paid = await call(api.base, `/api/requests/${created.requestId}/payment`, { method: 'POST', body: { txHash }, cookie: created.cookie });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.deepEqual(paid.body, { status: 'queued', position: 1 });
    const again = await call(api.base, `/api/requests/${created.requestId}/payment`, { method: 'POST', body: { txHash }, cookie: created.cookie });
    assert.deepEqual(again.body, { status: 'queued', position: 1 }, 'confirming the same tx again is idempotent');
    const jobs = await api.deps.pool.query(`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'review' AND singleton_key = $1`, [created.requestHash]);
    assert.equal(jobs.rows[0].n, 1);
    // A replay after the worker took the job reports where the request is, never `queued` at position 0.
    await transition(api.deps.pool, created.requestId, { to: 'running', actor: 'test', event: 'review_started', now: new Date() });
    const started = await call(api.base, `/api/requests/${created.requestId}/payment`, { method: 'POST', body: { txHash }, cookie: created.cookie });
    assert.equal(started.status, 200);
    conforms('payment-response', started.body);
    assert.deepEqual(started.body, { status: 'running', position: null });

    const second = await createRequest(api.base, api.deps.pool, await wallet(api.deps.pool, 'hank.mock'));
    const reused = await call(api.base, `/api/requests/${second.requestId}/payment`, { method: 'POST', body: { txHash }, cookie: second.cookie });
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error.code, 'TX_ALREADY_USED');
    const under = await createRequest(api.base, api.deps.pool, await wallet(api.deps.pool, 'ivy.mock'));
    const underTx = await pay(api.deps.pool, under, 'ivy.mock', '1');
    const underpaid = await call(api.base, `/api/requests/${under.requestId}/payment`, { method: 'POST', body: { txHash: underTx }, cookie: under.cookie });
    assert.equal(underpaid.status, 402);
    assert.equal(underpaid.body.error.code, 'PAYMENT_MISMATCH');
    const foreign = await call(api.base, `/api/requests/${under.requestId}/payment`, { method: 'POST', body: { txHash: underTx }, cookie: created.cookie });
    assert.equal(foreign.body.error.code, 'REQUEST_NOT_FOUND', "another account's session cannot pay or probe the request");
  });

  test('reads, sessions and error shapes', async () => {
    const dev = await wallet(api.deps.pool, 'jack.mock');
    const created = await createRequest(api.base, api.deps.pool, dev);
    const view = await call(api.base, `/api/requests/${created.requestId}`);
    assert.equal(view.status, 200);
    conforms('request-status-response', view.body);
    assert.equal(view.body.status, 'awaiting_payment');
    const mine = await call(api.base, '/api/requests?mine=1', { cookie: created.cookie });
    conforms('request-list-response', mine.body);
    assert.deepEqual(mine.body.requests.map((row: { requestId: string }) => row.requestId), [created.requestId]);
    const other = await createRequest(api.base, api.deps.pool, await wallet(api.deps.pool, 'kate.mock'));
    const theirs = await call(api.base, '/api/requests?mine=1', { cookie: other.cookie });
    assert.ok(!theirs.body.requests.some((row: { requestId: string }) => row.requestId === created.requestId));
    const [name, value] = created.cookie.split('=') as [string, string];
    const forged = await call(api.base, '/api/requests?mine=1', { cookie: `${name}=${value.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))}` });
    assert.equal(forged.status, 401);
    const unsigned = Buffer.from(JSON.stringify({ a: 'jack.mock', e: Date.now() + 1e7 })).toString('base64url');
    assert.equal((await call(api.base, '/api/requests?mine=1', { cookie: `sid=${unsigned}` })).status, 401);
    assert.equal((await call(api.base, '/api/requests?mine=1')).status, 401);
    const missing = await call(api.base, '/api/requests/3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'REQUEST_NOT_FOUND');
    const badId = await call(api.base, '/api/requests/not-a-uuid');
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error.code, 'VALIDATION_ERROR');
    assert.ok(!JSON.stringify(badId.body).includes('syntax'), 'no database message leaks');
    const unknown = await call(api.base, '/api/nope');
    assert.equal(unknown.status, 404);
    conforms('error-response', unknown.body);
    const big = await call(api.base, '/api/quote', { method: 'POST', body: { repoUrl: 'x'.repeat(20 * 1024), network: 'testnet' } });
    assert.equal(big.status, 413);
    conforms('error-response', big.body);
    const extra = await call(api.base, '/api/quote', { method: 'POST', body: { repoUrl: 'https://github.com/near/near-sdk-rs', network: 'testnet', x: 1 } });
    assert.equal(extra.body.error.code, 'VALIDATION_ERROR');
    assert.ok(created.cookie && sessionCookie);
  });

  test('guard verdicts come from the registry (mock chain) through the guard package', async () => {
    const codeHash = '8iTgRHpmMG2DzuPFDyBXTSkdxJMKmdNfmYo1sJUFKVNS';
    await setCodeHash(api.deps.pool, 'critical.testnet', codeHash);
    await seedAttestation(api.deps.pool, {
      requestHash: '5'.repeat(64), repo: 'omniswarm/bad-dex', commit: SHA, reportSha256: '6'.repeat(64), reportUri: 'https://reports.test/bad/report.html',
      deployed: 'critical.testnet', codeHash, maxSeverity: 'critical', bindingConfirmed: true,
    });
    const critical = await call(api.base, '/api/guard/verdict?account=critical.testnet');
    assert.equal(critical.status, 200, JSON.stringify(critical.body));
    conforms('guard-verdict-response', critical.body);
    assert.equal(critical.body.verdict, 'block');
    assert.ok(critical.body.reasons.includes('ATTESTED_CRITICAL_STILL_DEPLOYED'), JSON.stringify(critical.body));
    await setCodeHash(api.deps.pool, 'critical.testnet', 'GKot5hBsd81kMupNCXHaqbhv3huEbxAFMLnpcX2hniwn');
    const changed = await call(api.base, '/api/guard/verdict?account=critical.testnet');
    assert.ok(changed.body.reasons.includes('CODE_CHANGED_SINCE_REVIEW'), 'the live code hash is read from the chain');
    const invalid = await call(api.base, '/api/guard/verdict?account=NOT%20AN%20ACCOUNT');
    assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  });

  test('security headers are set and no CORS is granted without LANDING_ORIGIN', async () => {
    const reply = await call(api.base, '/api/health', { headers: { origin: 'https://evil.example' } });
    assert.equal(reply.headers.get('access-control-allow-origin'), null);
    assert.equal(reply.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(reply.headers.get('content-security-policy'));
  });
});
