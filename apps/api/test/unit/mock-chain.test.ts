// The mock registry against the contract rules W15-14 closed: deposit, storage, attest checks,
// locked/earned, a bounced refund, report events, binding and the payment-tx signer.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { after, before, test } from 'node:test';
import { ChainRejectedError } from '../../src/chain/errors.ts';
import { MockChainAdapter } from '../../src/chain/mock/mock-chain.ts';
import { chainEvents, confirmBinding, mockBalances, payRequestReview, retractReport } from '../../src/chain/mock/mock-ledger.ts';
import { MOCK_CHAIN_MIGRATIONS } from '../../src/chain/mock/schema.ts';
import { REQUEST_STORAGE_YOCTO } from '../../src/chain/mock/mock-validate.ts';
import { EMPTY_CODE_HASH, type AttestArgs } from '../../src/chain/port.ts';
import { applyMigrations } from '../../src/db/migrate.ts';
import { createPool, type Pool } from '../../src/db/pool.ts';
import { SERVER_URL, freshDatabase } from '../helpers/db.ts';

const PRICE = 10n ** 24n;
const CONTRACT = 'registry.test.near';

let pool: Pool | null = null;
let dropDatabase: (() => Promise<void>) | null = null;

before(async () => {
  const opened = await openDatabase();
  pool = opened.pool;
  dropDatabase = opened.drop;
  await applyMigrations(pool, MOCK_CHAIN_MIGRATIONS);
});

after(async () => {
  await pool?.end().catch(() => {});
  pool = null;
  const drop = dropDatabase;
  dropDatabase = null;
  await drop?.().catch(() => {});
});

function db(): Pool {
  if (!pool) throw new Error('mock chain database is not open');
  return pool;
}

function hash(): string {
  return crypto.randomBytes(32).toString('hex');
}

function chain(): MockChainAdapter {
  return new MockChainAdapter(db(), { contractId: CONTRACT, priceYocto: PRICE.toString(), failRate: 0, hangAfter: null });
}

function attestArgs(requestHash: string, patch: Partial<AttestArgs> = {}): AttestArgs {
  return {
    requestHash, repo: 'omni/parity', commit: 'ab'.repeat(20), reportSha256: 'cd'.repeat(32),
    reportUri: 'https://example.com/parity', deployed: null, codeHash: null, maxSeverity: 'low', ...patch,
  };
}

async function rejected(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof ChainRejectedError, error instanceof Error ? error.message : String(error));
    return error.reason;
  }
  assert.fail('expected ChainRejectedError');
}

async function absent(requestHash: string): Promise<void> {
  const row = await db().query('SELECT 1 FROM mock_chain_request WHERE request_hash = $1', [requestHash]);
  assert.equal(row.rowCount, 0);
}

test('mock chain matches the contract on deposits, attest, bounced refunds, reports and signers', async () => {
  const adapter = chain();
  const low = hash();
  assert.equal(await rejected(() => payRequestReview(db(), {
    signer: 'alice.test.near', receiver: CONTRACT, requestHash: low, depositYocto: '1', priceYocto: PRICE.toString(),
  })), 'ERR_DEPOSIT_LOW');
  await absent(low);
  const zero = hash();
  assert.equal(await rejected(() => payRequestReview(db(), {
    signer: 'alice.test.near', receiver: CONTRACT, requestHash: zero, depositYocto: '0', priceYocto: PRICE.toString(),
  })), 'ERR_DEPOSIT_LOW');
  await absent(zero);
  const storage = hash();
  assert.equal(await rejected(() => payRequestReview(db(), {
    signer: 'alice.test.near', receiver: CONTRACT, requestHash: storage, depositYocto: '1', priceYocto: '1',
  })), 'ERR_STORAGE_COST');
  await absent(storage);
  assert.ok(1n < REQUEST_STORAGE_YOCTO && REQUEST_STORAGE_YOCTO < PRICE);

  // The dashboard pays 0 and the intake underpay test plants 1 yocto, neither passing a price.
  const planted = hash();
  await payRequestReview(db(), { signer: 'ivy.mock', receiver: CONTRACT, requestHash: planted, depositYocto: '1' });
  assert.equal((await adapter.getRequest(planted))?.depositYocto, 1n);
  const free = hash();
  await payRequestReview(db(), { signer: 'operator', receiver: CONTRACT, requestHash: free, depositYocto: '0' });
  assert.equal((await adapter.getRequest(free))?.status, 'Pending');

  const paid = hash();
  const before = await mockBalances(db());
  const txHash = await payRequestReview(db(), {
    signer: 'alice.test.near', receiver: CONTRACT, requestHash: paid, depositYocto: PRICE.toString(), priceYocto: PRICE.toString(),
  });
  const open = await mockBalances(db());
  assert.equal(open.locked - before.locked, PRICE);
  assert.equal(open.earned - before.earned, 0n);
  assert.equal(await rejected(() => adapter.attest(attestArgs(paid, { maxSeverity: 'severe' as AttestArgs['maxSeverity'] }))), 'ERR_SEVERITY');
  assert.equal((await adapter.getRequest(paid))?.status, 'Pending');
  assert.equal((await adapter.getAttestation(paid)), null);
  assert.deepEqual(await chainEvents(db(), paid), ['review_requested']);
  const still = await mockBalances(db());
  assert.equal(still.locked - before.locked, PRICE);
  assert.equal(still.earned - before.earned, 0n);

  await adapter.attest(attestArgs(paid));
  assert.equal((await adapter.getRequest(paid))?.status, 'Done');
  const earned = await mockBalances(db());
  assert.equal(earned.locked - before.locked, 0n);
  assert.equal(earned.earned - before.earned, PRICE);
  assert.deepEqual(await chainEvents(db(), paid), ['review_requested', 'review_attested']);

  const back = hash();
  await payRequestReview(db(), {
    signer: 'bob.test.near', receiver: CONTRACT, requestHash: back, depositYocto: PRICE.toString(), priceYocto: PRICE.toString(),
  });
  assert.match(await adapter.refund(back), /^[1-9A-HJ-NP-Za-km-z]+$/);
  assert.equal((await adapter.getRequest(back))?.status, 'Refunded');
  assert.deepEqual(await chainEvents(db(), back), ['review_requested', 'review_refunded']);
  assert.equal(await rejected(() => adapter.refund(back)), 'ERR_BAD_STATUS');

  const bounce = hash();
  const payer = 'gone.test.near';
  await payRequestReview(db(), {
    signer: payer, receiver: CONTRACT, requestHash: bounce, depositYocto: PRICE.toString(), priceYocto: PRICE.toString(),
  });
  await db().query('DELETE FROM mock_chain_account WHERE account = $1', [payer]);
  assert.equal(await rejected(() => adapter.refund(bounce)), 'ERR_TRANSFER_FAILED');
  assert.equal((await adapter.getRequest(bounce))?.status, 'Pending');
  assert.deepEqual(await chainEvents(db(), bounce), ['review_requested', 'review_refunded', 'refund_failed']);
  const restored = await mockBalances(db());
  assert.equal(restored.locked - earned.locked, PRICE);

  const reported = `r${crypto.randomBytes(3).toString('hex')}.test.near`;
  await adapter.reportAddress({ accountId: reported, evidenceUri: 'https://example.com/evidence', reason: 'parity report' });
  const view = await adapter.viewRegistry('get_report', { account_id: reported }) as { reporter?: string };
  assert.equal(view.reporter, 'operator.mock');
  assert.equal(await adapter.viewAccountMethod(reported, 'contract_source_metadata', {}), null);
  assert.equal(await adapter.isReported(reported), true);
  await retractReport(db(), reported);
  assert.equal(await adapter.isReported(reported), false);
  const names = await db().query<{ event: string }>(
    `SELECT event FROM mock_chain_event
     WHERE data->>'account_id' = $1 OR data->'report'->>'account_id' = $1 ORDER BY id`, [reported]);
  assert.deepEqual(names.rows.map((row) => row.event), ['address_reported', 'report_retracted']);

  const bound = hash();
  await payRequestReview(db(), {
    signer: 'alice.test.near', receiver: CONTRACT, requestHash: bound, depositYocto: PRICE.toString(), priceYocto: PRICE.toString(),
  });
  await adapter.attest(attestArgs(bound, { deployed: 'bob.test.near', codeHash: EMPTY_CODE_HASH }));
  assert.equal(await adapter.getAttestationForAccount('bob.test.near'), null);
  await confirmBinding(db(), bound, 'bob.test.near');
  assert.equal((await adapter.getAttestationForAccount('bob.test.near'))?.requestHash, bound);
  assert.deepEqual(await chainEvents(db(), bound), ['review_requested', 'review_attested', 'binding_confirmed']);

  const found = await adapter.getPaymentTx(txHash, 'alice.test.near');
  assert.equal(found?.signerId, 'alice.test.near');
  assert.equal(found?.succeeded, true);
  assert.equal(found?.requestHash, paid);
  assert.equal(await adapter.getPaymentTx(txHash, 'mallory.mock'), null);
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function openDatabase(): Promise<{ pool: Pool; drop: () => Promise<void> }> {
  if (SERVER_URL) {
    const database = await freshDatabase('mockchain');
    return { pool: createPool(database.url, 4), drop: () => database.drop() };
  }
  const port = await freePort();
  const name = `w15-mock-${crypto.randomBytes(3).toString('hex')}`;
  const started = spawnSync('docker', [
    'run', '-d', '--rm', '--name', name,
    '-e', 'POSTGRES_USER=mock', '-e', 'POSTGRES_PASSWORD=mock', '-e', 'POSTGRES_DB=mock',
    '-p', `127.0.0.1:${port}:5432`, 'postgres:16-alpine',
  ], { encoding: 'utf8' });
  if (started.status !== 0) throw new Error(`postgres container failed to start: ${started.stderr.trim()}`);
  const drop = async () => { spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' }); };
  const url = `postgres://mock:mock@127.0.0.1:${port}/mock`;
  const deadline = Date.now() + 30_000;
  let last = 'not ready';
  while (Date.now() < deadline) {
    const probe = createPool(url, 1);
    try {
      await probe.query('SELECT 1');
      await probe.end();
      return { pool: createPool(url, 4), drop };
    } catch (error) {
      await probe.end().catch(() => {});
      last = error instanceof Error ? error.message : 'not ready';
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  await drop();
  throw new Error(`postgres did not become ready: ${last}`);
}
