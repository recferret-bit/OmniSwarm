// Migrations (ledger, advisory lock, no-op rerun) and the repositories' race and transition rules.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../../src/config/load.ts';
import { migrateAll } from '../../src/db/deploy.ts';
import { applyMigrations, CORE_MIGRATIONS, currentVersion, latestVersion, listMigrations } from '../../src/db/migrate.ts';
import { createPool, type Pool } from '../../src/db/pool.ts';
import { consumeNonce, issueNonce } from '../../src/db/repositories/nonces.ts';
import { findRequest, insertRequest, transition } from '../../src/db/repositories/requests.ts';
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
      [['nonce', 'request', 'request_progress', 'audit_log', 'rate_limit', 'request_cost']]);
    assert.equal(tables.rows[0].n, 6);
  });

  test('migration 012 on a populated database: legacy statuses become failed, chain tables and columns go', async () => {
    const legacy = await freshDatabase('legacy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-mig-'));
    for (const migration of listMigrations().filter((item) => item.version <= 11)) fs.copyFileSync(migration.file, path.join(dir, path.basename(migration.file)));
    const probe = createPool(legacy.url, 2);
    try {
      await applyMigrations(probe, { dir, ledger: CORE_MIGRATIONS.ledger });
      const stamp = '2026-11-01T00:00:00Z';
      const ids: Record<string, string> = {};
      let n = 0;
      for (const status of ['awaiting_payment', 'queued', 'running', 'publishing', 'done', 'failed', 'refunded', 'expired']) {
        const id = crypto.randomUUID();
        ids[status] = id;
        n += 1;
        await probe.query(
          `INSERT INTO request (id, account, repo, commit_sha, network, preset, request_hash, price_yocto, status, failure_cause, attest_tx, refund_tx, created_at, updated_at)
           VALUES ($1, 'a.near', 'o/r', $2, 'testnet', 'account-nearai', $3, 1000, $4, $5, $6, $7, $8, $8)`,
          [id, 'a'.repeat(40), String(n).repeat(64).slice(0, 64), status, status === 'failed' ? 'engine_error' : null, status === 'done' ? 'AttestTx' : null, status === 'refunded' ? 'RefundTx' : null, stamp]);
        await probe.query('INSERT INTO payment (tx_hash, request_id, amount_yocto, signer, verified_at) VALUES ($1, $2, 1000, $3, $4)', [`tx${n}`, id, 'a.near', stamp]);
        await probe.query('INSERT INTO request_cost (request_id, cost_usd, reviewers, recorded_at) VALUES ($1, 0.5, 2, $2)', [id, stamp]);
      }
      await probe.query(`INSERT INTO guard_report (id, account, reporter, evidence_url, reason, status, created_at) VALUES ($1, 'x.near', 'a.near', 'https://e.example/1', 'r', 'pending', $2)`, [crypto.randomUUID(), stamp]);
      await probe.query('CREATE TABLE mock_chain_migrations (version int)');
      await probe.query('CREATE TABLE mock_chain_request (id int)');
      await probe.query(`CREATE VIEW payment_totals AS SELECT request_id, amount_yocto FROM payment`);
      await probe.query('CREATE VIEW request_priced AS SELECT id, price_yocto FROM request');

      assert.deepEqual(await migrateAll(loadConfig('migrate', testEnv(legacy.url))), [12]);
      const rows = await probe.query<{ id: string; status: string; failure_cause: string | null }>('SELECT id, status, failure_cause FROM request');
      const by = new Map(rows.rows.map((row) => [row.id, row]));
      assert.equal(rows.rowCount, 8, 'no request is lost');
      for (const status of ['queued', 'running', 'publishing', 'done']) assert.equal(by.get(ids[status]!)?.status, status);
      for (const status of ['awaiting_payment', 'refunded', 'expired']) {
        assert.deepEqual({ status: by.get(ids[status]!)?.status, cause: by.get(ids[status]!)?.failure_cause }, { status: 'failed', cause: `migrated_from_${status}` });
      }
      assert.equal(by.get(ids.failed!)?.failure_cause, 'engine_error', 'an existing cause is kept');
      await assert.rejects(probe.query(`UPDATE request SET status = 'refunded' WHERE id = $1`, [ids.queued]), /request_status_check/);
      const columns = await probe.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'request'`);
      for (const gone of ['network', 'deployed', 'request_hash', 'price_yocto', 'attest_tx', 'refund_tx']) assert.ok(!columns.rows.some((c) => c.column_name === gone), gone);
      const tables = await probe.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
      for (const gone of ['payment', 'guard_report', 'mock_chain_migrations', 'mock_chain_request', 'payment_totals', 'request_priced']) assert.ok(!tables.rows.some((t) => t.table_name === gone), `${gone} (dependent views go with their tables and columns)`);
      assert.equal((await probe.query('SELECT count(*)::int AS n FROM request_cost')).rows[0].n, 8, 'cost rows stay');
      assert.deepEqual(await migrateAll(loadConfig('migrate', testEnv(legacy.url))), [], 'a rerun is a no-op');
    } finally {
      await probe.end();
      fs.rmSync(dir, { recursive: true, force: true });
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

  test('requests are inserted queued and transitions follow the table', async () => {
    const id = crypto.randomUUID();
    const row = { id, account: 'a.near', repo: 'o/r', commitSha: 'a'.repeat(40), preset: 'account-nearai', now: new Date() };
    await insertRequest(pool, row);
    assert.equal((await findRequest(pool, id))?.status, 'queued');
    await assert.rejects(transition(pool, id, { to: 'done', actor: 't', event: 'x', now: new Date() }), /INVALID_TRANSITION|cannot become done/);
    const running = await transition(pool, id, { to: 'running', actor: 't', event: 'review_started', now: new Date() });
    assert.equal(running.status, 'running');
    const log = await pool.query(`SELECT event, data->>'status' AS status FROM audit_log WHERE request_id = $1 ORDER BY id`, [id]);
    assert.deepEqual(log.rows, [{ event: 'request_created', status: null }, { event: 'review_started', status: 'running' }]);
    await assert.rejects(transition(pool, crypto.randomUUID(), { to: 'running', actor: 't', event: 'x', now: new Date() }), /not found/);
  });
});
