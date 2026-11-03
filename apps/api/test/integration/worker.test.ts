// W09 with in-process workers and the mock engine: the done path (progress, publish, attest once),
// the refund path, a completed review with critical findings, the job contract and the queue
// (singleton per request hash, rollback leaves no job), and WORKER_CONCURRENCY.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chainEvents } from '../../src/chain/mock/mock-ledger.ts';
import { withTransaction } from '../../src/db/pool.ts';
import { findRequest } from '../../src/db/repositories/requests.ts';
import { enqueueReview, JobContractError } from '../../src/queue/review-queue.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';
import { call, conforms, queuedRequest } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { migratedDb, startApi, startWorkerInProcess, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

async function settled(api: ApiStack, id: string, statuses = ['done', 'refunded', 'failed']) {
  return until(async () => {
    const row = await findRequest(api.deps.pool, id);
    return row && statuses.includes(row.status) ? row : null;
  }, 30_000);
}

describe('review worker (mock engine, mock chain)', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  before(async () => {
    t = await migratedDb('worker');
    api = await startApi(t.env);
  });
  after(async () => {
    await api?.close();
    await t?.db.drop();
  });

  test('a paid request runs, streams progress, publishes read-only and is attested once', async () => {
    const worker = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_STEP_MS: '150' });
    try {
      const request = await queuedRequest(api.base, api.deps.pool);
      const row = await settled(api, request.requestId);
      assert.equal(row.status, 'done', row.failure_cause ?? '');
      const view = await call(api.base, `/api/requests/${request.requestId}`);
      conforms('request-status-response', view.body);
      assert.equal(view.body.reportUrl, `https://reports.test/${request.requestId}/report.html`);
      assert.match(view.body.reportSha256, /^[0-9a-f]{64}$/);
      assert.ok(view.body.attestTx);
      assert.deepEqual(await chainEvents(api.deps.pool, request.requestHash), ['review_requested', 'review_running', 'review_attested']);
      const progress = await api.deps.pool.query('SELECT percent FROM request_progress WHERE request_id = $1 ORDER BY id', [request.requestId]);
      const percents = progress.rows.map((r) => Number(r.percent));
      assert.ok(percents.length >= 5, `progress rows: ${percents}`);
      assert.deepEqual([...percents].sort((a, b) => a - b), percents, 'percent never goes back');
      assert.equal(percents.at(-1), 100);

      const published = path.join(t.config.storage.reportsRoot, request.requestId);
      assert.ok(fs.existsSync(path.join(published, 'report.html')));
      assert.ok(fs.existsSync(path.join(published, 'reviewers/index.json')));
      assert.ok(!fs.existsSync(path.join(published, 'sessions')) && !fs.existsSync(path.join(published, 'harness')));
      assert.equal(fs.statSync(published).mode & 0o777, 0o555);
      assert.equal(fs.statSync(path.join(published, 'report.html')).mode & 0o777, 0o444);
      const manifest = JSON.parse(fs.readFileSync(path.join(published, 'published.json'), 'utf8'));
      assert.equal(manifest.reportSha256, view.body.reportSha256);
      const cli = spawnSync(process.execPath, [path.join(APP_ROOT, 'scripts/report-hash.ts'), published], { encoding: 'utf8' });
      assert.equal(cli.stdout.trim(), view.body.reportSha256, 'anyone can recompute the attested hash');
      const attestation = await api.deps.chain.getAttestation(request.requestHash);
      assert.equal(attestation?.reportSha256, view.body.reportSha256);
      assert.equal(attestation?.maxSeverity, 'medium');
      const dirs = fs.readdirSync(path.join(t.config.storage.runsRoot, request.requestId));
      assert.deepEqual(dirs, ['0']);
      assert.ok(fs.existsSync(path.join(t.config.storage.runsRoot, request.requestId, '0', 'worker.log')));
    } finally {
      await worker.close();
    }
  });

  test('infra failure refunds once; critical findings are attested and never refunded', async () => {
    const infra = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_FAIL: 'infra' });
    let failed;
    try {
      failed = await queuedRequest(api.base, api.deps.pool);
      const row = await settled(api, failed.requestId, ['refunded']);
      assert.equal(row.failure_cause, 'sandbox_unavailable');
      assert.ok(row.refund_tx);
    } finally {
      await infra.close();
    }
    assert.deepEqual(await chainEvents(api.deps.pool, failed.requestHash), ['review_requested', 'review_running', 'review_refunded']);
    const view = await call(api.base, `/api/requests/${failed.requestId}`);
    conforms('request-status-response', view.body);
    assert.ok(view.body.refundTx);

    const critical = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_FAIL: 'findings' });
    try {
      const request = await queuedRequest(api.base, api.deps.pool);
      const row = await settled(api, request.requestId);
      assert.equal(row.status, 'done');
      assert.equal(row.max_severity, 'critical');
      assert.deepEqual(await chainEvents(api.deps.pool, request.requestHash), ['review_requested', 'review_running', 'review_attested']);
    } finally {
      await critical.close();
    }
  });

  test('an engine that cannot start fails closed: no refund, operator alerted', async () => {
    const worker = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_FAIL: 'operator' });
    try {
      const request = await queuedRequest(api.base, api.deps.pool);
      const row = await settled(api, request.requestId, ['failed']);
      assert.match(row.failure_cause ?? '', /^operator:spawn_enoent/);
      assert.equal(row.attempts, 2, 'retried once before failing closed');
      assert.deepEqual(await chainEvents(api.deps.pool, request.requestHash), ['review_requested', 'review_running']);
    } finally {
      await worker.close();
    }
  });

  test('a crashing engine is retried once, then refunded', async () => {
    const worker = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_FAIL: 'crash' });
    try {
      const request = await queuedRequest(api.base, api.deps.pool);
      const row = await settled(api, request.requestId, ['refunded']);
      assert.equal(row.attempts, 2);
      assert.match(row.failure_cause ?? '', /^engine_error_after_retry/);
    } finally {
      await worker.close();
    }
  });

  test('one job per request hash; a rolled-back payment leaves no job; bad payloads are refused', async () => {
    const job = { requestId: '3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10', requestHash: 'e'.repeat(64), repo: 'near/near-sdk-rs', commitSha: 'a'.repeat(40), preset: 'scripted', network: 'testnet' as const };
    const first = await enqueueReview(api.deps.boss, api.deps.pool, job);
    const second = await enqueueReview(api.deps.boss, api.deps.pool, job);
    assert.ok(first);
    assert.equal(second, null);
    const rolled = { ...job, requestHash: 'f'.repeat(64) };
    await assert.rejects(withTransaction(api.deps.pool, async (client) => {
      await enqueueReview(api.deps.boss, client, rolled);
      throw new Error('payment failed after enqueue');
    }), /payment failed/);
    const left = await api.deps.pool.query(`SELECT count(*)::int AS n FROM pgboss.job WHERE singleton_key = $1`, [rolled.requestHash]);
    assert.equal(left.rows[0].n, 0);
    await assert.rejects(enqueueReview(api.deps.boss, api.deps.pool, { ...job, preset: 'cli:claude:opus' }), JobContractError);
    await api.deps.boss.deleteAllJobs('review');
  });

  test('WORKER_CONCURRENCY=1 runs one at a time with positions 1,2,3; 2 overlaps in separate dirs', async () => {
    const env = { ...t.env, MOCK_ENGINE_STEP_MS: '150' };
    const queued = [await queuedRequest(api.base, api.deps.pool), await queuedRequest(api.base, api.deps.pool), await queuedRequest(api.base, api.deps.pool)];
    assert.deepEqual(queued.map((q) => q.position), [1, 2, 3]);
    const serial = await startWorkerInProcess({ ...env, WORKER_CONCURRENCY: '1' });
    try {
      await until(async () => (await findRequest(api.deps.pool, queued[0]!.requestId))?.status === 'running');
      const positions = await Promise.all(queued.slice(1).map((q) => call(api.base, `/api/requests/${q.requestId}`)));
      assert.deepEqual(positions.map((p) => p.body.position), [1, 2]);
      for (const q of queued) await settled(api, q.requestId);
    } finally {
      await serial.close();
    }
    const windows = await runWindows(api, queued.map((q) => q.requestId));
    for (let i = 1; i < windows.length; i++) assert.ok(windows[i]!.start >= windows[i - 1]!.end, 'sequential');

    const pair = [await queuedRequest(api.base, api.deps.pool), await queuedRequest(api.base, api.deps.pool)];
    const parallel = await startWorkerInProcess({ ...env, WORKER_CONCURRENCY: '2' });
    try {
      for (const q of pair) await settled(api, q.requestId);
    } finally {
      await parallel.close();
    }
    const [a, b] = await runWindows(api, pair.map((q) => q.requestId));
    assert.ok(a!.start < b!.end && b!.start < a!.end, 'overlapping runs');
    for (const q of pair) assert.ok(fs.existsSync(path.join(t.config.storage.runsRoot, q.requestId, '0', 'report')));
  });
});

async function runWindows(api: ApiStack, ids: string[]) {
  const rows = await api.deps.pool.query(
    `SELECT request_id, min(ts) FILTER (WHERE event = 'review_started') AS start, max(ts) FILTER (WHERE event IN ('review_attested', 'review_refunded')) AS end
     FROM audit_log WHERE request_id = ANY($1::uuid[]) GROUP BY request_id`, [ids]);
  const byId = new Map(rows.rows.map((row) => [row.request_id, { start: row.start.getTime(), end: row.end.getTime() }]));
  return ids.map((id) => byId.get(id)).sort((x, y) => x!.start - y!.start);
}
