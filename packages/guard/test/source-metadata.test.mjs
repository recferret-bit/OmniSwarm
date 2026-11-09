import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../index.mjs';
import { createRecordedReader } from '../src/recorded-reader.mjs';
import { interpretSourceMetadata, parseSnapshot, sourceAgrees } from '../src/source-metadata.mjs';
import { viewSourceMetadata } from '../src/registry-reader.mjs';
import { RECORDS, NOW } from './chain.mjs';

const REV = 'c'.repeat(40);
const OTHER = 'a'.repeat(40);
const LINK = 'https://github.com/near/example';
const FETCHED = '2026-11-03T00:00:00.000Z';

test('parseSnapshot reads git+url?rev=sha and nothing else', () => {
  assert.deepEqual(parseSnapshot(`git+https://github.com/near/example?rev=${REV}`), { url: 'https://github.com/near/example', rev: REV });
  assert.equal(parseSnapshot(`git+https://github.com/near/example.git?rev=${REV}`)?.url, 'https://github.com/near/example.git');
  assert.equal(parseSnapshot('https://github.com/near/example'), null);
  assert.equal(parseSnapshot(`git+https://github.com/near/example#${REV}`), null);
});

test('NEP-330 JSON becomes link, rev, and the fetch time', () => {
  const raw = {
    version: '1.0.0',
    link: LINK,
    build_info: { source_code_snapshot: `git+${LINK}?rev=${REV}`, build_command: ['cargo', 'near', 'build'] },
  };
  assert.deepEqual(interpretSourceMetadata(raw, () => NOW), { link: LINK, rev: REV, fetchedAt: new Date(NOW).toISOString() });
  assert.equal(interpretSourceMetadata(null, () => NOW), null);
  assert.equal(interpretSourceMetadata({ standards: [] }, () => NOW), null);
});

test('a NEP-330 /tree/ link agrees when the snapshot names the attested repo and commit', async () => {
  const raw = {
    link: `https://github.com/near/example/tree/${REV}`,
    build_info: { source_code_snapshot: `git+https://github.com/near/example?rev=${REV}` },
  };
  const meta = interpretSourceMetadata(raw, () => NOW);
  assert.equal(meta?.rev, REV);
  assert.equal(sourceAgrees(meta, { repo: 'near/example', commit: REV }), true);
  const matched = await createGuard({ reader: withMetadata({ 'clean.testnet': raw }), now: () => NOW }).check('clean.testnet');
  assert.equal(matched.verdict, 'allow');
  assert.equal(matched.reasons.includes('SOURCE_METADATA_MISMATCH'), false);
  const elsewhere = interpretSourceMetadata({
    link: `https://github.com/other/elsewhere/tree/${REV}`,
    build_info: { source_code_snapshot: `git+https://github.com/near/example?rev=${REV}` },
  }, () => NOW);
  assert.equal(elsewhere?.rev, null);
  assert.equal(sourceAgrees(elsewhere, { repo: 'near/example', commit: REV }), false);
});

test('a snapshot that names a different repo than link does not count as a match', () => {
  const meta = interpretSourceMetadata({
    link: LINK,
    build_info: { source_code_snapshot: `git+https://github.com/other/elsewhere?rev=${REV}` },
  }, () => NOW);
  assert.equal(meta?.rev, null);
  assert.equal(sourceAgrees(meta, { repo: 'near/example', commit: REV }), false);
});

function withMetadata(table) {
  return createRecordedReader({ ...RECORDS, sourceMetadata: table });
}

const clean = { link: LINK, rev: REV, fetchedAt: FETCHED };

// [name, metadata for clean.testnet, verdict, reasons that must hold]
const TABLE = [
  ['match', { 'clean.testnet': { link: LINK, rev: REV, fetchedAt: FETCHED, build_info: { source_code_snapshot: `git+${LINK}?rev=${REV}` } } }, 'allow', ['ATTESTED_CLEAN']],
  ['mismatch', { 'clean.testnet': { link: 'https://github.com/other/elsewhere', rev: OTHER, fetchedAt: FETCHED } }, 'warn', ['SOURCE_METADATA_MISMATCH', 'ATTESTED_CLEAN']],
  ['absent', { 'clean.testnet': null }, 'allow', ['SOURCE_METADATA_ABSENT', 'ATTESTED_CLEAN']],
];

for (const [name, table, verdict, reasons] of TABLE) {
  test(`recorded reader: ${name} on a clean attestation`, async () => {
    const guard = createGuard({ reader: withMetadata(table), now: () => NOW });
    const result = await guard.check('clean.testnet');
    assert.equal(result.verdict, verdict);
    for (const code of reasons) assert.ok(result.reasons.includes(code), result.reasons.join(','));
    if (name === 'match') assert.equal(result.reasons.includes('SOURCE_METADATA_MISMATCH'), false);
    if (name === 'match') assert.equal(result.reasons.includes('SOURCE_METADATA_ABSENT'), false);
    if (name !== 'absent') {
      assert.equal(result.signals.sourceMetadata.rev, name === 'match' ? REV : OTHER);
      assert.equal(result.signals.sourceMetadata.link, name === 'match' ? LINK : 'https://github.com/other/elsewhere');
    } else {
      assert.equal(result.signals.sourceMetadata, null);
    }
  });
}

test('an RPC failure is SIGNAL_UNAVAILABLE and is not an allow by itself', async () => {
  const reader = createRecordedReader(
    { ...RECORDS, sourceMetadata: { 'clean.testnet': clean } },
    { fail: new Set(['getSourceMetadata']) },
  );
  const result = await createGuard({ reader, now: () => NOW }).check('clean.testnet');
  assert.equal(result.verdict, 'warn');
  assert.ok(result.reasons.includes('SIGNAL_UNAVAILABLE'));
  assert.equal(result.reasons.includes('SOURCE_METADATA_ABSENT'), false);
  assert.ok(result.signals.unavailable.includes('sourceMetadata'));
});

test('a reader with no metadata table leaves the signal unset', async () => {
  const result = await createGuard({ reader: createRecordedReader(RECORDS), now: () => NOW }).check('clean.testnet');
  assert.equal(result.verdict, 'allow');
  assert.deepEqual(result.reasons, ['ATTESTED_CLEAN']);
  assert.equal('sourceMetadata' in result.signals, false);
});

test('viewSourceMetadata turns a missing method into null and rethrows transport errors', async () => {
  const missing = await viewSourceMetadata(async () => { throw new Error('MethodResolveError: method not found'); }, 'dex.testnet');
  assert.equal(missing, null);
  const wrapped = new Error('The NEAR chain could not be reached');
  wrapped.cause = new Error('wasm execution failed with error: MethodResolveError(MethodNotFound)');
  assert.equal(await viewSourceMetadata(async () => { throw wrapped; }, 'dex.testnet'), null);
  const transport = new Error('The NEAR chain could not be reached');
  transport.cause = new Error('connection refused');
  await assert.rejects(viewSourceMetadata(async () => { throw transport; }, 'dex.testnet'));
  await assert.rejects(viewSourceMetadata(async () => { throw new Error('connection refused'); }, 'dex.testnet'));
  const raw = { link: LINK, build_info: { source_code_snapshot: `git+${LINK}?rev=${REV}` } };
  /** @type {[string, string, Record<string, unknown>][]} */
  const calls = [];
  const found = await viewSourceMetadata(async (accountId, method, args) => {
    calls.push([accountId, method, args]);
    return raw;
  }, 'dex.testnet');
  assert.deepEqual(found, raw);
  assert.deepEqual(calls, [['dex.testnet', 'contract_source_metadata', {}]]);
});
