// W09 with in-process workers and the mock engine: the done path (progress, publish), failures, a completed
// review with critical findings, the job contract and the queue (singleton per request, rollback leaves no
// job), WORKER_CONCURRENCY, and the same flow on a real deploy (non-mock key verifier that must never be called).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { withTransaction } from '../../src/db/pool.ts';
import { findRequest } from '../../src/db/repositories/requests.ts';
import { assertReviewJob, enqueueReview, JobContractError } from '../../src/queue/review-queue.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';
import { call, conforms, queuedJob, saveKey } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { migratedDb, startApi, startWorkerInProcess, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

async function settled(api: ApiStack, id: string, statuses = ['done', 'failed']) {
  return until(async () => {
    const row = await findRequest(api.deps.pool, id);
    return row && statuses.includes(row.status) ? row : null;
  }, 30_000);
}

describe('review worker (mock engine)', NEEDS_DB, () => {
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

  test('a queued request runs, streams progress and publishes read-only', async () => {
    const worker = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_STEP_MS: '150' });
    try {
      const request = await queuedJob(api.base);
      const row = await settled(api, request.requestId);
      assert.equal(row.status, 'done', row.failure_cause ?? '');
      const view = await call(api.base, `/api/requests/${request.requestId}`);
      conforms('request-status-response', view.body);
      assert.equal(view.body.reportUrl, `https://reports.test/${request.requestId}/report.html`);
      assert.match(view.body.reportSha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(view.body.timeline.map((event: { event: string }) => event.event), ['request_created', 'review_started', 'report_published', 'review_done']);
      assert.ok(!('attestTx' in view.body) && !('refundTx' in view.body));
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
      assert.equal(cli.stdout.trim(), view.body.reportSha256, 'anyone can recompute the report hash');
      assert.equal(row.max_severity, 'medium');
      const index = await call(api.base, `/api/reports/${request.requestId}`);
      assert.equal(index.status, 200, JSON.stringify(index.body));
      conforms('report-index-response', index.body);
      assert.deepEqual(
        { url: index.body.reportUrl, sha: index.body.reportSha256, reviewers: index.body.reviewers, general: index.body.generalReviewUrl },
        { url: view.body.reportUrl, sha: view.body.reportSha256, reviewers: ['scripted-baseline'], general: `https://reports.test/${request.requestId}/general-review.json` });
      assert.equal(index.body.repo, 'near/near-sdk-rs');
      assert.equal(index.body.maxSeverity, 'medium');
      assert.ok(index.body.check.total > 0 && index.body.check.passed <= index.body.check.total, JSON.stringify(index.body.check));
      assert.deepEqual(Object.keys(index.body.check).sort(), ['passed', 'total']);
      assert.ok(!('attestation' in index.body) && !('receipt' in index.body));
      const dirs = fs.readdirSync(path.join(t.config.storage.runsRoot, request.requestId));
      assert.deepEqual(dirs, ['0']);
      assert.ok(fs.existsSync(path.join(t.config.storage.runsRoot, request.requestId, '0', 'worker.log')));
    } finally {
      await worker.close();
    }
  });

  test('an infra failure fails the request once; critical findings still publish', async () => {
    const infra = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_FAIL: 'infra' });
    let failed;
    try {
      failed = await queuedJob(api.base);
      const row = await settled(api, failed.requestId, ['failed']);
      assert.equal(row.failure_cause, 'sandbox_unavailable');
    } finally {
      await infra.close();
    }
    const view = await call(api.base, `/api/requests/${failed.requestId}`);
    conforms('request-status-response', view.body);
    assert.equal(view.body.status, 'failed');
    assert.equal(view.body.failureCause, 'sandbox_unavailable');
    assert.deepEqual(view.body.timeline.map((event: { event: string }) => event.event), ['request_created', 'review_started', 'review_failed']);
    const noReport = await call(api.base, `/api/reports/${failed.requestId}`);
    assert.equal(noReport.status, 404);
    const unknown = await call(api.base, `/api/reports/${crypto.randomUUID()}`);
    assert.equal(unknown.body.error.code, 'REQUEST_NOT_FOUND');

    const critical = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_FAIL: 'findings' });
    try {
      const request = await queuedJob(api.base);
      const row = await settled(api, request.requestId);
      assert.equal(row.status, 'done');
      assert.equal(row.max_severity, 'critical');
      const index = await call(api.base, `/api/reports/${request.requestId}`);
      assert.equal(index.body.maxSeverity, 'critical');
    } finally {
      await critical.close();
    }
  });

  test('an engine that cannot start fails closed and the operator is alerted', async () => {
    const worker = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_FAIL: 'operator' });
    try {
      const request = await queuedJob(api.base);
      const row = await settled(api, request.requestId, ['failed']);
      assert.match(row.failure_cause ?? '', /^operator:spawn_enoent/);
      assert.equal(row.attempts, 2, 'retried once before failing closed');
    } finally {
      await worker.close();
    }
  });

  test('a crashing engine is retried once, then failed', async () => {
    const worker = await startWorkerInProcess({ ...t.env, MOCK_ENGINE_FAIL: 'crash' });
    try {
      const request = await queuedJob(api.base);
      const row = await settled(api, request.requestId, ['failed']);
      assert.equal(row.attempts, 2);
      assert.match(row.failure_cause ?? '', /^engine_error_after_retry/);
    } finally {
      await worker.close();
    }
  });

  test('one job per request; a rolled-back insert leaves no job; bad and legacy payloads are handled', async () => {
    const job = { requestId: '3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10', repo: 'near/near-sdk-rs', commitSha: 'a'.repeat(40), preset: 'account-nearai' };
    const first = await enqueueReview(api.deps.boss, api.deps.pool, job);
    const second = await enqueueReview(api.deps.boss, api.deps.pool, job);
    assert.ok(first);
    assert.equal(second, null);
    const rolled = { ...job, requestId: '4f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10' };
    await assert.rejects(withTransaction(api.deps.pool, async (client) => {
      await enqueueReview(api.deps.boss, client, rolled);
      throw new Error('insert failed after enqueue');
    }), /insert failed/);
    const left = await api.deps.pool.query(`SELECT count(*)::int AS n FROM pgboss.job WHERE singleton_key = $1`, [rolled.requestId]);
    assert.equal(left.rows[0].n, 0);
    await assert.rejects(enqueueReview(api.deps.boss, api.deps.pool, { ...job, preset: 'cli:claude:opus' }), JobContractError);
    // A job queued before the payment fields were removed still carries them: they are dropped, not refused.
    assert.deepEqual(assertReviewJob({ ...job, requestHash: 'e'.repeat(64), network: 'testnet' }), job);
    await api.deps.boss.deleteAllJobs('review');
  });

  test('WORKER_CONCURRENCY=1 runs one at a time with positions 1,2,3; 2 overlaps in separate dirs', async () => {
    const env = { ...t.env, MOCK_ENGINE_STEP_MS: '150' };
    const queued = [await queuedJob(api.base), await queuedJob(api.base), await queuedJob(api.base)];
    const first = await call(api.base, `/api/requests/${queued[0]!.requestId}`);
    assert.equal(first.body.position, 1);
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

    const pair = [await queuedJob(api.base), await queuedJob(api.base)];
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

  test('step-by-step cloud pipeline: Stage 1 -> Step 2 Advise -> Step 3 Debate rounds publish artifacts and URLs', async () => {
    const envStep = { ...t.env, MOCK_ENGINE_STEP_MS: '20' };
    const apiStep = await startApi(envStep);
    const worker = await startWorkerInProcess(envStep);
    try {
      const login = await call(apiStep.base, '/api/login', { method: 'POST', body: { login: 'operator', password: 'operator' } });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      // Every dashboard step runs on the signed-in account's own NEAR AI Cloud key and models.
      const saved = await call(apiStep.base, '/api/account/providers/nearai', {
        method: 'PUT', cookie, body: { key: 'near-test-key-not-real-0000', models: ['deepseek-ai/DeepSeek-V4', 'Qwen/Qwen3.8-Max'] },
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));

      // 1. Stage 1 only (no debates, no advice yet)
      const created = await call(apiStep.base, '/api/dashboard/jobs', {
        method: 'POST',
        cookie,
        body: { repo: 'near/near-sdk-rs', pipelineMode: 'stage-1' },
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const stage1Id = created.body.requestId as string;
      assert.equal((await settled(apiStep, stage1Id)).status, 'done');

      const s1Status = await call(apiStep.base, `/api/requests/${stage1Id}`);
      conforms('request-status-response', s1Status.body);
      assert.equal(s1Status.body.pipeline?.currentStage, 'stage-1');
      assert.equal(s1Status.body.pipeline?.noDebates, true);
      assert.equal(s1Status.body.pipeline?.advice, undefined);

      // 2. Step 2 Frontier Orchestrator Advice
      const advised = await call(apiStep.base, `/api/requests/${stage1Id}/advise`, { method: 'POST', cookie });
      assert.equal(advised.status, 201, JSON.stringify(advised.body));
      const adviseId = advised.body.requestId as string;
      assert.equal((await settled(apiStep, adviseId)).status, 'done');

      const s1AfterAdvise = await call(apiStep.base, `/api/requests/${stage1Id}`);
      assert.deepEqual(s1AfterAdvise.body.pipeline?.nextRoundRequestIds, [adviseId]);

      const s2Status = await call(apiStep.base, `/api/requests/${adviseId}`);
      conforms('request-status-response', s2Status.body);
      assert.equal(s2Status.body.pipeline?.currentStage, 'stage-2-advice');
      assert.equal(s2Status.body.pipeline?.advice?.debateNeeded, true);

      // 3. Step 3 Iterative Debate (+2 rounds)
      const debated = await call(apiStep.base, `/api/requests/${adviseId}/debate`, { method: 'POST', cookie, body: { rounds: 2 } });
      assert.equal(debated.status, 201, JSON.stringify(debated.body));
      const round2Id = debated.body.requestId as string;
      assert.equal((await settled(apiStep, round2Id)).status, 'done');

      const s2AfterDebate = await call(apiStep.base, `/api/requests/${adviseId}`);
      assert.deepEqual(s2AfterDebate.body.pipeline?.nextRoundRequestIds, [round2Id]);

      const s3Status = await call(apiStep.base, `/api/requests/${round2Id}`);
      conforms('request-status-response', s3Status.body);
      assert.equal(s3Status.body.pipeline?.currentStage, 'stage-3-debate');
      assert.equal(s3Status.body.pipeline?.roundsCompleted, 2);
      assert.equal(s3Status.body.pipeline?.noDebates, false);

      const reportIdx = await call(apiStep.base, `/api/reports/${round2Id}`);
      conforms('report-index-response', reportIdx.body);
      assert.ok(reportIdx.body.stage1Url?.endsWith('/audit_stage_1.html'));
      assert.ok(reportIdx.body.adviceUrl?.endsWith('/audit_stage_2_advice.html'));
      assert.ok(reportIdx.body.pipelineUrl?.endsWith('/pipeline-progress.json'));
      assert.equal(reportIdx.body.roundUrls?.length, 2);
    } finally {
      await worker.close();
      await apiStep.close();
    }
  });

  test('a dashboard job runs end to end on a real deploy: the non-mock verifier is wired and never asked', async () => {
    let rpcCalls = 0;
    const rpc = http.createServer((_req, res) => { rpcCalls += 1; res.writeHead(500).end(); });
    await new Promise<void>((resolve) => rpc.listen(0, '127.0.0.1', resolve));
    const env = { ...t.env, KEY_VERIFIER: 'rpc', RPC_URLS: `http://127.0.0.1:${(rpc.address() as AddressInfo).port}` };
    const real = await startApi(env);
    const worker = await startWorkerInProcess(env);
    try {
      assert.equal(real.deps.keys.kind, 'rpc');
      assert.equal(real.deps.config.keys.verifier, 'rpc');
      const login = await call(real.base, '/api/login', { method: 'POST', body: { login: 'operator', password: 'operator' } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      await saveKey(real.base, cookie);
      const created = await call(real.base, '/api/dashboard/jobs', { method: 'POST', cookie, body: { repo: 'near/near-sdk-rs' } });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const row = await settled(real, created.body.requestId);
      assert.equal(row.status, 'done', row.failure_cause ?? '');
      const index = await call(real.base, `/api/reports/${created.body.requestId}`);
      assert.equal(index.status, 200);
      conforms('report-index-response', index.body);
      assert.equal(rpcCalls, 0, 'no chain step ran');
    } finally {
      await worker.close();
      await real.close();
      rpc.close();
    }
  });
});

async function runWindows(api: ApiStack, ids: string[]) {
  const rows = await api.deps.pool.query(
    `SELECT request_id, min(ts) FILTER (WHERE event = 'review_started') AS start, max(ts) FILTER (WHERE event IN ('review_done', 'review_failed')) AS end
     FROM audit_log WHERE request_id = ANY($1::uuid[]) GROUP BY request_id`, [ids]);
  const byId = new Map(rows.rows.map((row) => [row.request_id, { start: row.start.getTime(), end: row.end.getTime() }]));
  return ids.map((id) => byId.get(id)).sort((x, y) => x!.start - y!.start);
}
