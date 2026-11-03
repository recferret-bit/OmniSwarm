import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../../apps/api/src/app.ts';
import { attestationCount, createPool, getRequest, insertRequest, migrate, queuePosition, refundOnce, reset, setStatus } from '../../../apps/api/src/store.ts';
import { auditArgv, drainOne } from '../../../apps/api/src/worker.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// These specs reset (TRUNCATE) the database they are given. There is no default URL, so
// they never touch a developer's own Postgres: set DATABASE_URL to a throwaway database.
const DATABASE_URL = process.env.DATABASE_URL || '';
const NEEDS_DB = DATABASE_URL ? {} : { skip: 'DATABASE_URL is not set; these specs TRUNCATE their database, so point it at a throwaway Postgres to run them' };
const SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

const AUDIT_BIN = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);
fs.writeFileSync(path.join(process.cwd(), 'argv.json'), JSON.stringify(process.argv));
fs.writeFileSync(path.join(process.cwd(), 'child-pid.txt'), String(process.pid));
const spawns = path.join(process.cwd(), 'spawns.txt');
const seen = fs.existsSync(spawns) ? Number(fs.readFileSync(spawns, 'utf8')) : 0;
fs.writeFileSync(spawns, String(seen + 1));
if (argv.includes('--rpc')) process.exit(3);
const out = argv[argv.indexOf('--out') + 1];
fs.mkdirSync(out, { recursive: true });
const fail = process.env.MOCK_ENGINE_FAIL || '';
if (fail === 'infra') {
  process.stderr.write('infra failure');
  process.exit(1);
}
const findings = fail === 'findings'
  ? { findings: [{ id: 'C-1', severity: 'critical', title: 'still deployed' }] }
  : { findings: [] };
fs.writeFileSync(path.join(out, 'findings-and-scores.json'), JSON.stringify(findings));
fs.writeFileSync(path.join(out, 'general-review.json'), JSON.stringify({ summary: 'mock' }));
`;

function plantEngine(dir) {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  const file = path.join(dir, 'bin', 'audit');
  fs.writeFileSync(file, AUDIT_BIN);
  fs.chmodSync(file, 0o755);
  return dir;
}

function spawns(dir) {
  return Number(fs.readFileSync(path.join(dir, 'spawns.txt'), 'utf8'));
}

test('audit argv is the engine command and never includes --rpc', () => {
  const argv = auditArgv({ repo: 'near/near-sdk-rs', ref: SHA, preset: 'scripted', out: '/tmp/omniswarm-out' });
  assert.deepEqual(argv, ['./bin/audit', 'run', '--github', 'near/near-sdk-rs', '--ref', SHA, '--preset', 'scripted', '--out', '/tmp/omniswarm-out']);
  assert.equal(argv.includes('--rpc'), false);
  assert.throws(() => auditArgv({ repo: 'near/near-sdk-rs', ref: SHA, preset: 'scripted', out: '/tmp/out --rpc' }), /rejected/);
});

test('mock worker spawns ./bin/audit, attests once, refunds infra once, and resumes a pre-attest kill', NEEDS_DB, async () => {
  const pool = createPool(DATABASE_URL);
  await migrate(pool);
  await reset(pool);
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'w09-reports-'));
  const engine = plantEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'w09-engine-')));
  const opts = { reportsRoot: reports, engineRoot: engine };
  const now = Date.now();
  async function seed(n) {
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

  const done = await drainOne(pool, { ...opts, mode: 'ok' });
  assert.ok(done);
  assert.equal(done.status, 'done');
  assert.equal(done.argv.includes('--rpc'), false);
  assert.equal(done.argv[0], './bin/audit');
  assert.equal(done.argv[1], 'run');
  const recorded = JSON.parse(fs.readFileSync(path.join(engine, 'argv.json'), 'utf8'));
  assert.equal(recorded[1].endsWith(`${path.sep}bin${path.sep}audit`), true);
  assert.equal(recorded[2], 'run');
  assert.equal(recorded.includes('--rpc'), false);
  assert.notEqual(Number(fs.readFileSync(path.join(engine, 'child-pid.txt'), 'utf8')), process.pid);
  assert.match(done.hash, /^[0-9a-f]{64}$/);
  const hashed = spawnSync(process.execPath, [path.join(ROOT, 'apps/api/scripts/report-hash.ts'), path.join(reports, done.id)], { encoding: 'utf8' });
  assert.equal(hashed.status, 0, hashed.stderr);
  assert.equal(hashed.stdout.trim(), done.hash);
  assert.equal(await attestationCount(pool, (await getRequest(pool, done.id)).request_hash), 1);
  assert.deepEqual(await Promise.all([queuePosition(pool, ids[1]), queuePosition(pool, ids[2])]), [1, 2]);

  const infra = await drainOne(pool, { ...opts, mode: 'infra' });
  assert.equal(infra?.status, 'refunded');
  const again = await refundOnce(pool, (await getRequest(pool, infra.id)).request_hash);
  assert.equal(again.created, false);
  assert.equal(again.count, 1);

  const critical = await drainOne(pool, { ...opts, mode: 'findings' });
  assert.equal(critical?.status, 'done');
  const criticalHash = (await getRequest(pool, critical.id)).request_hash;
  const refunds = await pool.query('SELECT count(*)::int AS n FROM mock_refund WHERE request_hash = $1', [criticalHash]);
  assert.equal(refunds.rows[0].n, 0);
  assert.equal(await attestationCount(pool, criticalHash), 1);

  const attestedId = await seed(4);
  const attested = await drainOne(pool, { ...opts, crashAfter: 'attested' });
  assert.equal(attested?.id, attestedId);
  assert.equal(attested?.status, 'running');
  assert.equal(await attestationCount(pool, (await getRequest(pool, attestedId)).request_hash), 1);

  const earlyId = await seed(5);
  const early = await drainOne(pool, { ...opts, crashAfter: 'before-attest' });
  assert.equal(early?.id, earlyId);
  assert.equal(early?.status, 'running');
  assert.equal(await attestationCount(pool, (await getRequest(pool, earlyId)).request_hash), 0);
  const beforeRestart = spawns(engine);
  const restarted = spawnSync(process.execPath, [path.join(ROOT, 'apps/api/scripts/worker.ts')], {
    env: { ...process.env, DATABASE_URL, REPORTS_ROOT: reports, ENGINE_ROOT: engine },
    encoding: 'utf8',
  });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.match(restarted.stdout, new RegExp(`${attestedId} done`));
  assert.match(restarted.stdout, new RegExp(`${earlyId} done`));
  assert.match(restarted.stdout, /worker finished 2/);
  assert.equal(spawns(engine), beforeRestart + 1);
  assert.equal((await getRequest(pool, attestedId)).status, 'done');
  assert.equal((await getRequest(pool, earlyId)).status, 'done');
  assert.equal(await attestationCount(pool, (await getRequest(pool, attestedId)).request_hash), 1);
  assert.equal(await attestationCount(pool, (await getRequest(pool, earlyId)).request_hash), 1);

  const app = await createApp({ databaseUrl: DATABASE_URL, sessionSecret: 'test-session-secret', adminToken: 'admin-test' });
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  const denied = await fetch(`${base}/api/admin/requests/${done.id}/refund`, { method: 'POST', headers: { 'x-admin-token': 'admin-test' } });
  const body = await denied.json();
  assert.equal(denied.status, 409);
  assert.equal(body.error.code, 'REFUND_NOT_ALLOWED');
  await app.close();
  await pool.end();
});
