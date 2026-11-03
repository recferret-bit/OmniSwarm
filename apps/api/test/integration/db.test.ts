// Migrations (ledger, advisory lock, no-op rerun) and the repositories' race and transition rules.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../../src/config/load.ts';
import { migrateAll } from '../../src/db/deploy.ts';
import { currentVersion, latestVersion } from '../../src/db/migrate.ts';
import { createPool, type Pool } from '../../src/db/pool.ts';
import { consumeNonce, issueNonce } from '../../src/db/repositories/nonces.ts';
import { insertRequest, transition } from '../../src/db/repositories/requests.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';
import { freshDatabase, NEEDS_DB, type TestDatabase } from '../helpers/db.ts';
import { testEnv } from '../helpers/stack.ts';

function migrateProcess(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(APP_ROOT, 'src/bin/migrate.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('exit', (code) => resolve({ code, out }));
  });
}

describe('database', NEEDS_DB, () => {
  let db: TestDatabase;
  let pool: Pool;
  before(async () => {
    db = await freshDatabase('db');
    pool = createPool(db.url, 6);
  });
  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  test('two concurrent `npm run db:migrate` serialize under the lock; a rerun is a no-op', async () => {
    const env = testEnv(db.url);
    const [a, b] = await Promise.all([migrateProcess(env), migrateProcess(env)]);
    assert.equal(a.code, 0, a.out);
    assert.equal(b.code, 0, b.out);
    assert.deepEqual([a.out, b.out].map((out) => out.includes('up to date')).sort(), [false, true], 'exactly one applied the migrations');
    assert.equal(await currentVersion(pool), latestVersion());
    assert.deepEqual(await migrateAll(loadConfig('migrate', env)), []);
    const tables = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [['nonce', 'request', 'payment', 'request_progress', 'audit_log', 'rate_limit']]);
    assert.equal(tables.rows[0].n, 6);
  });

  test('mock chain tables: only for CHAIN_ADAPTER=mock outside production, dropped from production when empty', async () => {
    const mockTables = async (url: string) => {
      const probe = createPool(url, 1);
      try {
        const rows = await probe.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'mock\\_chain\\_%' ORDER BY 1`);
        return rows.rows.map((row) => row.table_name as string);
      } finally {
        await probe.end();
      }
    };
    assert.ok((await mockTables(db.url)).includes('mock_chain_request'), 'the test database (CHAIN_ADAPTER=mock) has them');

    const near = await freshDatabase('near');
    try {
      await migrateAll(loadConfig('migrate', { ...testEnv(near.url), CHAIN_ADAPTER: 'near' }));
      assert.deepEqual(await mockTables(near.url), [], 'a near-adapter database never gets them');
    } finally {
      await near.drop();
    }

    // A production database migrated before the split holds them (empty): the deploy step drops them.
    const legacy = await freshDatabase('legacy');
    const production = { NODE_ENV: 'production', DATABASE_URL: legacy.url, LOG_LEVEL: 'silent' };
    try {
      await migrateAll(loadConfig('migrate', testEnv(legacy.url)));
      const legacyPool = createPool(legacy.url, 1);
      await legacyPool.query(`INSERT INTO mock_chain_account (account, code_hash) VALUES ('x.mock', '1')`);
      await assert.rejects(migrateAll(loadConfig('migrate', production)), /refusing to drop mock chain tables that hold rows in production: mock_chain_account/);
      assert.ok((await mockTables(legacy.url)).includes('mock_chain_account'), 'nothing dropped when one holds a row');
      await legacyPool.query('DELETE FROM mock_chain_account');
      await legacyPool.end();
      await migrateAll(loadConfig('migrate', production));
      assert.deepEqual(await mockTables(legacy.url), []);
      assert.deepEqual(await migrateAll(loadConfig('migrate', production)), [], 'a rerun is a no-op');
    } finally {
      await legacy.drop();
    }
  });

  test('a nonce is consumed exactly once under concurrency', async () => {
    const nonce = crypto.randomBytes(32).toString('base64');
    const now = new Date();
    await issueNonce(pool, nonce, now, new Date(now.getTime() + 60_000), '127.0.0.1');
    const results = await Promise.all(Array.from({ length: 6 }, () => consumeNonce(pool, nonce, now)));
    assert.deepEqual(results.sort(), ['ok', 'used', 'used', 'used', 'used', 'used']);
    assert.equal(await consumeNonce(pool, 'missing', now), 'missing');
  });

  test('transitions follow the table and duplicate request hashes are refused', async () => {
    const id = crypto.randomUUID();
    const row = { id, account: 'a.mock', repo: 'o/r', commitSha: 'a'.repeat(40), network: 'testnet', preset: 'scripted', deployed: null, requestHash: 'b'.repeat(64), priceYocto: '1', now: new Date() };
    await insertRequest(pool, row);
    await assert.rejects(insertRequest(pool, { ...row, id: crypto.randomUUID() }), /request_request_hash_key/);
    await assert.rejects(transition(pool, id, { to: 'done', actor: 't', event: 'x', now: new Date() }), /INVALID_TRANSITION|cannot become done/);
    const queued = await transition(pool, id, { to: 'queued', actor: 't', event: 'payment_verified', now: new Date() });
    assert.equal(queued.status, 'queued');
    const log = await pool.query(`SELECT event, data->>'status' AS status FROM audit_log WHERE request_id = $1 ORDER BY id`, [id]);
    assert.deepEqual(log.rows, [{ event: 'request_created', status: null }, { event: 'payment_verified', status: 'queued' }]);
    await assert.rejects(transition(pool, crypto.randomUUID(), { to: 'queued', actor: 't', event: 'x', now: new Date() }), /not found/);
  });
});
