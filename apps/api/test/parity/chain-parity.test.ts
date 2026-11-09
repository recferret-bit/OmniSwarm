// One scenario table through MockChainAdapter and NearChainAdapter.
// Diffs ok, the error code, status and event names. The mock is left as it is:
// a row that is not `same` names the field W15-14 still has to close.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, type KeyPairString } from 'near-api-js';
import { MockChainAdapter } from '../../src/chain/mock/mock-chain.ts';
import { payRequestReview, registerKey, setCodeHash } from '../../src/chain/mock/mock-ledger.ts';
import { MOCK_CHAIN_MIGRATIONS } from '../../src/chain/mock/schema.ts';
import { ChainRejectedError } from '../../src/chain/errors.ts';
import { NearChainAdapter } from '../../src/chain/near/near-chain.ts';
import { loadOperatorKey } from '../../src/chain/near/operator-key.ts';
import { panicReason } from '../../src/chain/near/payment-tx.ts';
import { EMPTY_CODE_HASH, type AttestArgs, type ChainPort } from '../../src/chain/port.ts';
import { applyMigrations } from '../../src/db/migrate.ts';
import { createPool, type Pool } from '../../src/db/pool.ts';
import { AppError } from '../../src/shared/errors.ts';
import { SERVER_URL, freshDatabase, type TestDatabase } from '../helpers/db.ts';

const SKIP = 'skipped: near-sandbox not running';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RPC_PORT = process.env.NEAR_LOCAL_RPC_PORT || '3030';
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const CONTRACT = 'registry.test.near';
const ALICE = 'alice.test.near';
const BOB = 'bob.test.near';
const TREASURY = 'treasury.test.near';
const GAS = 100_000_000_000_000n;
const FUND = 10n * 10n ** 24n;
const ATTEST = {
  repo: 'omni/parity',
  commit: 'ab'.repeat(20),
  reportSha256: 'cd'.repeat(32),
  reportUri: 'https://example.com/parity',
};

interface Observed {
  ok: boolean;
  error: string | null;
  status: string | null;
  events: string[];
}

interface Row {
  scenario: string;
  mock: Observed;
  near: Observed;
}

interface Lane {
  readonly kind: 'mock' | 'near';
  begin(): Promise<void>;
  events(): Promise<string[]>;
  pay(accountId: string, requestHash: string, deposit: bigint): Promise<void>;
  markRunning(requestHash: string): Promise<void>;
  attest(args: AttestArgs): Promise<void>;
  refund(requestHash: string): Promise<void>;
  report(accountId: string): Promise<void>;
  retract(accountId: string): Promise<void>;
  confirmBinding(accountId: string, requestHash: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
  requestStatus(requestHash: string): Promise<string | null>;
  reported(accountId: string): Promise<boolean>;
}

const sandboxUp = await probeSandbox(RPC_URL);

let pool: Pool | null = null;
let dropDatabase: (() => Promise<void>) | null = null;

after(async () => {
  await shutdown();
});

test('chain parity', sandboxUp ? { timeout: 300_000 } : { skip: SKIP, timeout: 300_000 }, async () => {
  const opened = await openDatabase();
  pool = opened.pool;
  dropDatabase = opened.drop;
  await applyMigrations(pool, MOCK_CHAIN_MIGRATIONS);

  const recorder = new RecordingProvider({ url: RPC_URL }, { retries: 2, wait: 100, backoff: 2 });
  const near = new NearChainAdapter({
    rpcUrls: [RPC_URL],
    contractId: CONTRACT,
    operatorAccountId: null,
    operator: () => loadOperatorKey(keyPath('operator')),
  }, recorder);
  const health = await near.health();
  if (!health.rpc || !health.contract) throw new Error('sandbox registry is not reachable');
  const price = await near.getPrice();
  if (price <= 1n) throw new Error('registry price must be above 1 yocto for the deposit scenarios');

  const mock = new MockChainAdapter(pool, {
    contractId: CONTRACT,
    priceYocto: price.toString(),
    failRate: 0,
    hangAfter: null,
  });
  const signers = new SignerBook(recorder);
  const nearLane = new NearLane(near, recorder, signers);
  const mockLane = new MockLane(mock, pool, price.toString());
  const rows = await runScenarios({ nearLane, mockLane, price, signers });
  const table = render(rows);
  console.log(`\n${table}\n`);
  assert.equal(table.includes('ed25519:'), false, 'the table must not contain a key');
  assert.equal(rows.length, 9);
  const happy = rows[0];
  assert.equal(happy?.scenario, 'happy path');
  assert.equal(happy?.near.ok, true, JSON.stringify(happy?.near));
  assert.equal(happy?.near.status, 'Done');
  assert.equal(happy?.mock.ok, true, JSON.stringify(happy?.mock));
  assert.equal(happy?.mock.status, 'Done');
  await near.close();
});

async function shutdown(): Promise<void> {
  const current = pool;
  pool = null;
  await current?.end().catch(() => {});
  const drop = dropDatabase;
  dropDatabase = null;
  await drop?.().catch(() => {});
}

async function probeSandbox(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/status`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const body = await response.json() as { chain_id?: string };
    return body.chain_id === 'sandbox';
  } catch {
    return false;
  }
}

function keyPath(name: string): string {
  return path.join(ROOT, 'infra/compose/.local/near/keys', `${name}.json`);
}

function readKey(file: string): { accountId: string; secret: KeyPairString } {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { account_id?: string; private_key?: string; secret_key?: string };
  const secret = parsed.private_key ?? parsed.secret_key ?? '';
  if (!parsed.account_id || !/^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]+$/.test(secret)) {
    throw new Error(`unusable key file ${path.basename(file)}`);
  }
  return { accountId: parsed.account_id, secret: secret as KeyPairString };
}

function requestHash(): string {
  return crypto.randomBytes(32).toString('hex');
}

function errorCode(error: unknown): string {
  if (error instanceof ChainRejectedError) return error.reason;
  if (error instanceof AppError) return error.code;
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current) && parts.length < 6) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return /ERR_[A-Z0-9_]+/.exec(parts.join(' '))?.[0] ?? 'ERR_TX_FAILED';
}

function eventNames(raw: unknown): string[] {
  const response = raw as {
    transaction_outcome?: { outcome?: { logs?: string[] } };
    receipts_outcome?: Array<{ outcome?: { logs?: string[] } }>;
  };
  const logs = [
    ...(response.transaction_outcome?.outcome?.logs ?? []),
    ...(response.receipts_outcome ?? []).flatMap((receipt) => receipt.outcome?.logs ?? []),
  ];
  const names: string[] = [];
  for (const log of logs) {
    if (!log.startsWith('EVENT_JSON:')) continue;
    try {
      const parsed = JSON.parse(log.slice('EVENT_JSON:'.length)) as { event?: unknown };
      if (typeof parsed.event === 'string') names.push(parsed.event);
    } catch {
      // A non-JSON log is not an event name.
    }
  }
  return names;
}

function attestArgs(requestHashValue: string, patch: Partial<AttestArgs> = {}): AttestArgs {
  return {
    requestHash: requestHashValue,
    repo: ATTEST.repo,
    commit: ATTEST.commit,
    reportSha256: ATTEST.reportSha256,
    reportUri: ATTEST.reportUri,
    deployed: null,
    codeHash: null,
    maxSeverity: 'low',
    ...patch,
  };
}

class RecordingProvider extends JsonRpcProvider {
  readonly sent: unknown[] = [];
  #mark = 0;

  override sendTransactionUntil(...args: Parameters<JsonRpcProvider['sendTransactionUntil']>) {
    return super.sendTransactionUntil(...args).then((result) => {
      this.sent.push(result);
      return result;
    });
  }

  begin(): void {
    this.#mark = this.sent.length;
  }

  recorded(): unknown[] {
    const names = new Map<string, unknown>();
    const fresh: unknown[] = [];
    for (const raw of this.sent.slice(this.#mark)) {
      const hash = (raw as { transaction?: { hash?: string } }).transaction?.hash;
      if (hash && names.has(hash)) continue;
      if (hash) names.set(hash, raw);
      fresh.push(raw);
    }
    return fresh;
  }
}

class SignerBook {
  readonly #provider: RecordingProvider;
  readonly #accounts = new Map<string, Account>();

  constructor(provider: RecordingProvider) {
    this.#provider = provider;
    for (const name of ['alice', 'bob', 'owner']) {
      const key = readKey(keyPath(name));
      this.#accounts.set(key.accountId, new Account(key.accountId, provider, KeyPairSigner.fromSecretKey(key.secret)));
    }
    const validator = readKey(path.join(ROOT, 'infra/compose/.local/near/home/validator_key.json'));
    if (validator.accountId !== 'test.near') throw new Error('validator key is not test.near');
    this.#accounts.set(validator.accountId, new Account(validator.accountId, provider, KeyPairSigner.fromSecretKey(validator.secret)));
  }

  get(accountId: string): Account {
    const account = this.#accounts.get(accountId);
    if (!account) throw new Error(`no signer for ${accountId}`);
    return account;
  }

  async createPayer(): Promise<string> {
    const pair = KeyPair.fromRandom('ed25519');
    const accountId = `b${crypto.randomBytes(8).toString('hex')}.test.near`;
    await submit(this.get('test.near'), accountId, [
      actions.createAccount(),
      actions.transfer(FUND),
      actions.addFullAccessKey(pair.getPublicKey()),
    ]);
    this.#accounts.set(accountId, new Account(accountId, this.#provider, KeyPairSigner.fromSecretKey(pair.toString())));
    return accountId;
  }
}

async function submit(account: Account, receiverId: string, txActions: Parameters<Account['signAndSendTransaction']>[0]['actions']): Promise<void> {
  const response = await account.signAndSendTransaction({
    receiverId,
    actions: txActions,
    waitUntil: 'FINAL',
    throwOnFailure: false,
    retries: 3,
  });
  const reason = panicReason(response);
  if (reason) throw new ChainRejectedError(reason);
}

class NearLane implements Lane {
  readonly kind = 'near' as const;
  readonly #chain: ChainPort;
  readonly #recorder: RecordingProvider;
  readonly #signers: SignerBook;

  constructor(chain: ChainPort, recorder: RecordingProvider, signers: SignerBook) {
    this.#chain = chain;
    this.#recorder = recorder;
    this.#signers = signers;
  }

  async begin(): Promise<void> {
    this.#recorder.begin();
  }

  async events(): Promise<string[]> {
    return this.#recorder.recorded().flatMap((raw) => eventNames(raw));
  }

  pay(accountId: string, requestHashValue: string, deposit: bigint): Promise<void> {
    return submit(this.#signers.get(accountId), CONTRACT, [
      actions.functionCall('request_review', { request_hash: requestHashValue }, GAS, deposit),
    ]);
  }

  markRunning(requestHashValue: string): Promise<void> {
    return this.#chain.markRunning(requestHashValue).then(() => {});
  }

  attest(args: AttestArgs): Promise<void> {
    return this.#chain.attest(args).then(() => {});
  }

  refund(requestHashValue: string): Promise<void> {
    return this.#chain.refund(requestHashValue).then(() => {});
  }

  report(accountId: string): Promise<void> {
    return this.#chain.reportAddress({
      accountId,
      evidenceUri: 'https://example.com/evidence',
      reason: 'parity report',
    }).then(() => {});
  }

  retract(accountId: string): Promise<void> {
    return submit(this.#signers.get('owner.test.near'), CONTRACT, [
      actions.functionCall('retract_report', { account_id: accountId }, GAS, 0n),
    ]);
  }

  confirmBinding(accountId: string, requestHashValue: string): Promise<void> {
    return submit(this.#signers.get(accountId), CONTRACT, [
      actions.functionCall('confirm_binding', { request_hash: requestHashValue }, GAS, 0n),
    ]);
  }

  async deleteAccount(accountId: string): Promise<void> {
    // The delete succeeds, then the gas refund receipt fails because the account is already gone.
    // That receipt is not a failed delete. panicReason would treat it as one.
    const response = await this.#signers.get(accountId).signAndSendTransaction({
      receiverId: accountId,
      actions: [actions.deleteAccount(TREASURY)],
      waitUntil: 'FINAL',
      throwOnFailure: false,
      retries: 3,
    });
    const status = (response as { status?: Record<string, unknown> }).status;
    if (!status || 'Failure' in status) {
      throw new ChainRejectedError(/ERR_[A-Z0-9_]+/.exec(JSON.stringify(status))?.[0] ?? 'ERR_TX_FAILED');
    }
  }

  async requestStatus(requestHashValue: string): Promise<string | null> {
    return (await this.#chain.getRequest(requestHashValue))?.status ?? null;
  }

  reported(accountId: string): Promise<boolean> {
    return this.#chain.isReported(accountId);
  }
}

class MockLane implements Lane {
  readonly kind = 'mock' as const;
  readonly #chain: ChainPort;
  readonly #pool: Pool;
  readonly #price: string;
  #mark = '0';

  constructor(chain: ChainPort, db: Pool, price: string) {
    this.#chain = chain;
    this.#pool = db;
    this.#price = price;
  }

  async begin(): Promise<void> {
    const result = await this.#pool.query<{ id: string }>('SELECT coalesce(max(id), 0)::text AS id FROM mock_chain_event');
    this.#mark = result.rows[0]?.id ?? '0';
  }

  async events(): Promise<string[]> {
    const result = await this.#pool.query<{ event: string }>(
      'SELECT event FROM mock_chain_event WHERE id > $1 ORDER BY id', [this.#mark]);
    return result.rows.map((row) => row.event);
  }

  async pay(accountId: string, requestHashValue: string, deposit: bigint): Promise<void> {
    // A row in both tables means the account exists. deleteAccount removes them.
    await registerKey(this.#pool, accountId, 'ed25519:11111111111111111111111111111111', 'FullAccess');
    await setCodeHash(this.#pool, accountId, EMPTY_CODE_HASH);
    const payment = {
      signer: accountId,
      receiver: CONTRACT,
      requestHash: requestHashValue,
      depositYocto: deposit.toString(),
      priceYocto: this.#price,
    };
    await payRequestReview(this.#pool, payment);
  }

  markRunning(requestHashValue: string): Promise<void> {
    return this.#chain.markRunning(requestHashValue).then(() => {});
  }

  attest(args: AttestArgs): Promise<void> {
    return this.#chain.attest(args).then(() => {});
  }

  refund(requestHashValue: string): Promise<void> {
    return this.#chain.refund(requestHashValue).then(() => {});
  }

  report(accountId: string): Promise<void> {
    return this.#chain.reportAddress({
      accountId,
      evidenceUri: 'https://example.com/evidence',
      reason: 'parity report',
    }).then(() => {});
  }

  // mock-ledger may later export retractReport(db, accountId). Until then the report stays.
  async retract(accountId: string): Promise<void> {
    await ledgerCall('retractReport', [this.#pool, accountId]);
  }

  // mock-ledger may later export confirmBinding(db, requestHash, accountId).
  async confirmBinding(accountId: string, requestHashValue: string): Promise<void> {
    await ledgerCall('confirmBinding', [this.#pool, requestHashValue, accountId]);
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.#pool.query('DELETE FROM mock_chain_key WHERE account = $1', [accountId]);
    await this.#pool.query('DELETE FROM mock_chain_account WHERE account = $1', [accountId]);
  }

  async requestStatus(requestHashValue: string): Promise<string | null> {
    return (await this.#chain.getRequest(requestHashValue))?.status ?? null;
  }

  reported(accountId: string): Promise<boolean> {
    return this.#chain.isReported(accountId);
  }
}

async function ledgerCall(name: string, args: unknown[]): Promise<void> {
  const ledger = await import('../../src/chain/mock/mock-ledger.ts') as Record<string, unknown>;
  const fn = ledger[name];
  if (typeof fn !== 'function') return;
  await (fn as (...all: unknown[]) => Promise<unknown>)(...args);
}

async function observe(lane: Lane, act: () => Promise<void>, status: () => Promise<string | null>): Promise<Observed> {
  await lane.begin();
  let error: string | null = null;
  try {
    await act();
  } catch (caught) {
    error = errorCode(caught);
  }
  let state: string | null = null;
  try {
    state = await status();
  } catch (caught) {
    if (error === null) error = errorCode(caught);
  }
  return { ok: error === null, error, status: state, events: await lane.events() };
}

interface ScenarioDeps {
  nearLane: NearLane;
  mockLane: MockLane;
  price: bigint;
  signers: SignerBook;
}

async function runScenarios(deps: ScenarioDeps): Promise<Row[]> {
  const { nearLane, mockLane, price } = deps;
  const both = async (
    scenario: string,
    act: (lane: Lane, request: string) => Promise<void>,
    status: (lane: Lane, request: string) => Promise<string | null>,
    prepare?: () => Promise<void>,
  ): Promise<{ row: Row; request: string }> => {
    const request = requestHash();
    if (prepare) await prepare();
    return {
      request,
      row: {
        scenario,
        mock: await observe(mockLane, () => act(mockLane, request), () => status(mockLane, request)),
        near: await observe(nearLane, () => act(nearLane, request), () => status(nearLane, request)),
      },
    };
  };
  const requestStatus = (lane: Lane, request: string) => lane.requestStatus(request);

  const happy = await both('happy path', async (lane, request) => {
    await lane.pay(ALICE, request, price);
    await lane.markRunning(request);
    await lane.attest(attestArgs(request));
  }, requestStatus);

  const refund = await both('refund', async (lane, request) => {
    await lane.pay(ALICE, request, price);
    await lane.refund(request);
  }, requestStatus);

  let bouncePayer = '';
  // NearChainAdapter throws ERR_TX_FAILED: panicReason sees the failed transfer receipt
  // before it reads the refund bool, so the call never becomes ERR_TRANSFER_FAILED.
  const bounce = await both('refund bounce', async (lane, request) => {
    await lane.pay(bouncePayer, request, price);
    await lane.deleteAccount(bouncePayer);
    await lane.refund(request);
  }, requestStatus, async () => {
    bouncePayer = await deps.signers.createPayer();
  });

  let reportedAccount = '';
  const report = await both('report/retract', async (lane) => {
    await lane.report(reportedAccount);
    await lane.retract(reportedAccount);
  }, async (lane) => (await lane.reported(reportedAccount)) ? 'reported' : 'clear', async () => {
    reportedAccount = `r${crypto.randomBytes(4).toString('hex')}.test.near`;
  });

  const low = await both('low deposit', async (lane, request) => {
    await lane.pay(ALICE, request, 1n);
  }, requestStatus);

  const zero = await both('zero deposit', async (lane, request) => {
    await lane.pay(ALICE, request, 0n);
  }, requestStatus);

  const severity = await both('bad severity', async (lane, request) => {
    await lane.pay(ALICE, request, price);
    await lane.attest(attestArgs(request, { maxSeverity: 'severe' as AttestArgs['maxSeverity'] }));
  }, requestStatus);
  // The failed attest leaves the deposit locked. Give it back outside the diff window.
  await nearLane.refund(severity.request).catch(() => {});

  const deployed = await both('attest for a deployed account', async (lane, request) => {
    await lane.pay(ALICE, request, price);
    await lane.attest(attestArgs(request, { deployed: BOB, codeHash: EMPTY_CODE_HASH }));
  }, requestStatus);

  const binding = await both('binding', async (lane, request) => {
    await lane.pay(ALICE, request, price);
    await lane.attest(attestArgs(request, { deployed: BOB, codeHash: EMPTY_CODE_HASH, maxSeverity: 'info' }));
    await lane.confirmBinding(BOB, request);
  }, requestStatus);

  return [happy.row, refund.row, bounce.row, report.row, low.row, zero.row, severity.row, deployed.row, binding.row];
}

const FIELD_LABEL = [
  ['ok', 'ok'],
  ['error', 'error code'],
  ['status', 'status'],
  ['events', 'events'],
] as const;

function render(rows: Row[]): string {
  const header = ['scenario', 'result', 'ok', 'error code', 'status', 'events'];
  const body = rows.map((row) => {
    const differs = FIELD_LABEL.filter(([field]) => !sameField(row, field)).map(([, label]) => label);
    return [
      row.scenario,
      differs.length === 0 ? 'same' : differs.join(', '),
      pair(String(row.mock.ok), String(row.near.ok)),
      pair(dash(row.mock.error), dash(row.near.error)),
      pair(dash(row.mock.status), dash(row.near.status)),
      pair(dash(row.mock.events.join(',')), dash(row.near.events.join(','))),
    ];
  });
  const width = header.map((cell, index) => Math.max(cell.length, ...body.map((line) => line[index]?.length ?? 0)));
  const format = (cells: string[]) => cells.map((cell, index) => cell.padEnd(width[index] ?? cell.length)).join('  ');
  return [
    'chain parity: one value when both sides agree, otherwise mock / near',
    format(header),
    ...body.map(format),
  ].join('\n');
}

function sameField(row: Row, field: 'ok' | 'error' | 'status' | 'events'): boolean {
  if (field === 'ok') return row.mock.ok === row.near.ok;
  if (field === 'error') return row.mock.error === row.near.error;
  if (field === 'status') return row.mock.status === row.near.status;
  return row.mock.events.join('\n') === row.near.events.join('\n');
}

function dash(value: string | null): string {
  return value && value.length > 0 ? value : '-';
}

function pair(mock: string, near: string): string {
  return mock === near ? mock : `${mock} / ${near}`;
}

async function openDatabase(): Promise<{ pool: Pool; drop: () => Promise<void> }> {
  if (SERVER_URL) {
    const database: TestDatabase = await freshDatabase('parity');
    return { pool: createPool(database.url, 4), drop: () => database.drop() };
  }
  const port = await freePort();
  const name = `w15-parity-${crypto.randomBytes(3).toString('hex')}`;
  const started = spawnSync('docker', [
    'run', '-d', '--rm', '--name', name,
    '-e', 'POSTGRES_USER=parity',
    '-e', 'POSTGRES_PASSWORD=parity',
    '-e', 'POSTGRES_DB=parity',
    '-p', `127.0.0.1:${port}:5432`,
    'postgres:16-alpine',
  ], { encoding: 'utf8' });
  if (started.status !== 0) throw new Error(`postgres container failed to start: ${started.stderr.trim()}`);
  const drop = async () => {
    spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  };
  const url = `postgres://parity:parity@127.0.0.1:${port}/parity`;
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
      last = error instanceof Error ? error.message.replace(/postgres:\/\/[^@\s]+@/g, 'postgres://***@') : 'not ready';
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  await drop();
  throw new Error(`postgres did not become ready: ${last}`);
}

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
