import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../backend/intake/src/app.ts';
import { attestationCount, createPool, getRequest, insertRequest, migrate, queuePosition, refundOnce, reset, setStatus } from '../../backend/intake/src/store.ts';
import { auditArgv, drainOne, resume } from '../../backend/intake/src/worker.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://omniswarm:omniswarm@127.0.0.1:55432/omniswarm';
const SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

test('audit argv is the engine command and never includes --rpc', () => {
  const argv = auditArgv({ repo: 'near/near-sdk-rs', ref: SHA, preset: 'scripted', out: '/tmp/omniswarm-out' });
  assert.deepEqual(argv, ['./bin/audit', 'run', '--github', 'near/near-sdk-rs', '--ref', SHA, '--preset', 'scripted', '--out', '/tmp/omniswarm-out']);
  assert.equal(argv.includes('--rpc'), false);
  assert.throws(() => auditArgv({ repo: 'near/near-sdk-rs', ref: SHA, preset: 'scripted', out: '/tmp/out --rpc' }), /rejected/);
});

test('mock worker attests once, refunds infra once, keeps critical findings, and resumes', async () => {
  const pool = createPool(DATABASE_URL);
  await migrate(pool);
  await reset(pool);
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'w09-reports-'));
  const now = Date.now();
  async function seed(n: number) {
    const id = crypto.randomUUID();
    await insertRequest(pool, {
      id, account: 'alice.mock', repo: 'near/near-sdk-rs', commitSha: SHA, network: 'testnet', preset: 'scripted',
      requestHash: crypto.randomBytes(32).toString('hex'), priceYocto: '1000000000000000000000000', now: new Date(now + n),
    });
    await setStatus(pool, id, 'queued', new Date(now + n));
    return id;
  }
  const ids = [await seed(1), await seed(2), await seed(3)];
  assert.deepEqual(await Promise.all(ids.map((id) => queuePosition(pool, id))), [1, 2, 3]);

  const done = await drainOne(pool, { reportsRoot: reports, mode: 'ok' });
  assert.ok(done);
  assert.equal(done.status, 'done');
  assert.equal(done.argv.includes('--rpc'), false);
  assert.equal(done.argv[0], './bin/audit');
  assert.equal(done.argv[1], 'run');
  assert.match(done.hash, /^[0-9a-f]{64}$/);
  const hashed = spawnSync(process.execPath, [path.join(ROOT, 'backend/intake/scripts/report-hash.ts'), path.join(reports, done.id)], { encoding: 'utf8' });
  assert.equal(hashed.status, 0, hashed.stderr);
  assert.equal(hashed.stdout.trim(), done.hash);
  assert.equal(await attestationCount(pool, (await getRequest(pool, done.id)).request_hash), 1);
  assert.deepEqual(await Promise.all([queuePosition(pool, ids[1]), queuePosition(pool, ids[2])]), [1, 2]);

  const infra = await drainOne(pool, { reportsRoot: reports, mode: 'infra' });
  assert.equal(infra?.status, 'refunded');
  const again = await refundOnce(pool, (await getRequest(pool, infra!.id)).request_hash);
  assert.equal(again.created, false);
  assert.equal(again.count, 1);

  const critical = await drainOne(pool, { reportsRoot: reports, mode: 'findings' });
  assert.equal(critical?.status, 'done');
  const criticalHash = (await getRequest(pool, critical!.id)).request_hash;
  const refunds = await pool.query('SELECT count(*)::int AS n FROM mock_refund WHERE request_hash = $1', [criticalHash]);
  assert.equal(refunds.rows[0].n, 0);
  assert.equal(await attestationCount(pool, criticalHash), 1);

  const crashedId = await seed(4);
  const crashed = await drainOne(pool, { reportsRoot: reports, crashAfter: 'attested' });
  assert.equal(crashed?.id, crashedId);
  assert.equal(crashed?.status, 'running');
  assert.equal(await resume(pool, crashedId), 1);
  assert.equal((await getRequest(pool, crashedId)).status, 'done');
  assert.equal(await attestationCount(pool, (await getRequest(pool, crashedId)).request_hash), 1);

  const app = await createApp({ databaseUrl: DATABASE_URL, sessionSecret: 'test-session-secret', adminToken: 'admin-test' });
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  const denied = await fetch(`${base}/api/admin/requests/${done.id}/refund`, { method: 'POST', headers: { 'x-admin-token': 'admin-test' } });
  const body = await denied.json();
  assert.equal(denied.status, 409);
  assert.equal(body.error.code, 'REFUND_NOT_ALLOWED');
  await app.close();
  await pool.end();
});
