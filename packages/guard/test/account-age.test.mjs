// The optional AccountAgeSource port, its recorded implementation and the NearBlocks source
// behind the `accountAgeFromConfig` flag. NearBlocks is only ever reached through a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../index.mjs';
import { accountAgeFromConfig, createdAtMsOf, nearblocksAgeSource } from '../src/account-age.mjs';
import { createRecordedAgeSource } from '../src/recorded-reader.mjs';
import { NOW, reader } from './chain.mjs';

const DAY = 86_400_000;
const NS_PER_MS = 1_000_000n;

/** The recorded chain without the reader's own age method: what the API passes today. */
function readerWithoutAge() {
  const { getAccountAgeDays, ...rest } = reader();
  assert.equal(typeof getAccountAgeDays, 'function');
  return rest;
}

const check = (accountAge, account = 'clean.testnet', base = readerWithoutAge()) => createGuard({ reader: base, accountAge, now: () => NOW }).check(account);

/** @param {Record<string, unknown>} bodies  account → JSON body (or a number for an HTTP status) */
function fakeNearBlocks(bodies) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.authorization, signal: init.signal });
    const id = decodeURIComponent(String(url).split('/').pop());
    const body = bodies[id];
    if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body ?? { account: [] } };
  };
  return { fetch, calls };
}

const createdBody = (ms) => ({ account: [{ account_id: 'x', created: { transaction_hash: 'h', block_timestamp: Number(BigInt(ms) * NS_PER_MS) } }] });

test('without an age source the age is unavailable and the verdict warns (as before)', async () => {
  const result = await check(undefined);
  assert.deepEqual([result.verdict, result.reasons], ['warn', ['SIGNAL_UNAVAILABLE', 'ATTESTED_CLEAN']]);
  assert.deepEqual([result.signals.ageDays, result.signals.unavailable], [null, ['accountAge']]);
});

test('with an age source an old attested contract is allowed', async () => {
  const result = await check(createRecordedAgeSource({ 'clean.testnet': NOW - 400 * DAY }));
  assert.deepEqual([result.verdict, result.reasons, result.signals.ageDays], ['allow', ['ATTESTED_CLEAN'], 400]);
});

test('a young account warns ACCOUNT_TOO_NEW; a creation time in the future counts as 0 days', async () => {
  const young = await check(createRecordedAgeSource({ 'clean.testnet': NOW - 3 * DAY }));
  assert.deepEqual([young.verdict, young.reasons], ['warn', ['ACCOUNT_TOO_NEW', 'ATTESTED_CLEAN']]);
  const future = await check(createRecordedAgeSource({ 'clean.testnet': NOW + DAY }));
  assert.equal(future.signals.ageDays, 0);
});

test('the age source takes precedence over the reader method', async () => {
  // The recorded reader says 400 days; the port says 2.
  const result = await check(createRecordedAgeSource({ 'clean.testnet': NOW - 2 * DAY }), 'clean.testnet', reader());
  assert.equal(result.signals.ageDays, 2);
  assert.ok(result.reasons.includes('ACCOUNT_TOO_NEW'));
});

test('an unknown account or a failing source is unavailable, never allow', async () => {
  for (const source of [createRecordedAgeSource({}), createRecordedAgeSource({ 'clean.testnet': NOW - 400 * DAY }, { fail: true }), { getCreatedAtMs: async () => Number.NaN }]) {
    const result = await check(source);
    assert.equal(result.verdict, 'warn');
    assert.deepEqual(result.signals.unavailable, ['accountAge']);
  }
});

test('createGuard refuses an accountAge without getCreatedAtMs', () => {
  assert.throws(() => createGuard({ reader: reader(), accountAge: /** @type {any} */ ({}) }), /getCreatedAtMs/);
});

test('the flag is off by default and refuses unknown providers', () => {
  assert.equal(accountAgeFromConfig(), undefined);
  assert.equal(accountAgeFromConfig({ provider: 'off', network: 'testnet' }), undefined);
  assert.throws(() => accountAgeFromConfig({ provider: 'fastnear', network: 'testnet' }), /unknown account age provider/);
  assert.throws(() => accountAgeFromConfig({ provider: 'nearblocks' }), /network/);
});

test('nearblocks: network base URL, optional bearer key, timeout signal', async () => {
  const { fetch, calls } = fakeNearBlocks({ 'clean.testnet': createdBody(NOW - 400 * DAY) });
  const keyed = accountAgeFromConfig({ provider: 'nearblocks', network: 'testnet', apiKey: 'k1', fetch });
  assert.equal(await keyed.getCreatedAtMs('clean.testnet'), NOW - 400 * DAY);
  await nearblocksAgeSource({ network: 'mainnet', fetch }).getCreatedAtMs('clean.testnet');
  assert.deepEqual(calls.map((c) => [c.url, c.auth]), [
    ['https://api-testnet.nearblocks.io/v1/account/clean.testnet', 'Bearer k1'],
    ['https://api.nearblocks.io/v1/account/clean.testnet', undefined],
  ]);
  assert.ok(calls.every((c) => c.signal instanceof AbortSignal));
});

test('nearblocks: the answer shape is checked', () => {
  const ms = NOW - 10 * DAY;
  assert.equal(createdAtMsOf(createdBody(ms)), ms);
  assert.equal(createdAtMsOf({ account: [{ created: { block_timestamp: String(BigInt(ms) * NS_PER_MS) } }] }), ms);
  assert.equal(createdAtMsOf({ account: [] }), null);
  assert.equal(createdAtMsOf({ account: [{ created: { block_timestamp: null } }] }), null);
  for (const bad of [{}, null, { account: {} }, { account: [{ created: { block_timestamp: '-1' } }] }, { account: [{ created: { block_timestamp: 1.5e30 } }] }]) {
    assert.throws(() => createdAtMsOf(bad), TypeError, JSON.stringify(bad));
  }
});

test('nearblocks: HTTP errors reject, which the guard turns into SIGNAL_UNAVAILABLE', async () => {
  const { fetch } = fakeNearBlocks({ 'clean.testnet': 429 });
  const source = nearblocksAgeSource({ network: 'testnet', fetch });
  await assert.rejects(source.getCreatedAtMs('clean.testnet'), /429/);
  const result = await check(source);
  assert.deepEqual([result.verdict, result.signals.unavailable], ['warn', ['accountAge']]);
});

test('nearblocks: known answers are cached for a day, unknown ones are not', async () => {
  let now = NOW;
  const { fetch, calls } = fakeNearBlocks({ 'clean.testnet': createdBody(NOW - 400 * DAY) });
  const source = nearblocksAgeSource({ network: 'testnet', fetch, now: () => now, cacheSize: 1 });
  await source.getCreatedAtMs('clean.testnet');
  await source.getCreatedAtMs('clean.testnet');
  assert.equal(calls.length, 1);
  assert.equal(await source.getCreatedAtMs('nobody.testnet'), null);
  assert.equal(await source.getCreatedAtMs('nobody.testnet'), null);
  assert.equal(calls.length, 3);
  now += DAY + 1;
  await source.getCreatedAtMs('clean.testnet');
  assert.equal(calls.length, 4);
});

test('nearblocks: the cache is bounded', async () => {
  const { fetch, calls } = fakeNearBlocks({ 'a.testnet': createdBody(NOW - DAY), 'b.testnet': createdBody(NOW - DAY) });
  const source = nearblocksAgeSource({ network: 'testnet', fetch, now: () => NOW, cacheSize: 1 });
  await source.getCreatedAtMs('a.testnet');
  await source.getCreatedAtMs('b.testnet');
  await source.getCreatedAtMs('a.testnet');
  assert.equal(calls.length, 3);
});

test('end to end: the flag-selected source makes an old attested contract allow', async () => {
  const { fetch } = fakeNearBlocks({ 'clean.testnet': createdBody(NOW - 400 * DAY) });
  const result = await check(accountAgeFromConfig({ provider: 'nearblocks', network: 'testnet', fetch }));
  assert.deepEqual([result.verdict, result.reasons], ['allow', ['ATTESTED_CLEAN']]);
});
