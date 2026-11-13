// Password dashboard and loopback local jobs. Skips without DATABASE_URL, like the other integration tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { setLocalJobStarter, type LocalLaunch } from '../../src/modules/operator/local-audit.ts';
import { writeAccountKey } from '../../src/modules/providers/account-keys.ts';
import { insertRequest } from '../../src/db/repositories/requests.ts';
import { reportPdfBytes } from '../../src/shared/report-pdf.ts';
import { call, sessionCookie } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { SHA, migratedDb, startApi, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

describe('operator dashboard and local jobs', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  const admin = `Basic ${Buffer.from('admin:admin-test-password').toString('base64')}`;
  before(async () => {
    t = await migratedDb('operator', { ADMIN_BASIC_USER: 'admin', ADMIN_BASIC_PASSWORD: 'admin-test-password' });
    api = await startApi(t.env);
    // A dashboard job runs only on the signed-in account's own key (dashboard.service.ts): give `operator` a fake one.
    await writeAccountKey(api.deps.pool, api.deps.config.accountKeysSecret, 'operator', 'nearai',
      { key: 'near-test-key-not-real-operator', models: ['deepseek-ai/DeepSeek-V4', 'Qwen/Qwen3.8-Max'] }, new Date());
  });
  after(async () => {
    setLocalJobStarter(null);
    await api?.close();
    await t?.db.drop();
  });

  test('operator/operator sets a session; a wrong password is 401; GET /api/session reads it', async () => {
    const wrong = await call(api.base, '/api/login', { method: 'POST', body: { login: 'operator', password: 'wrong-pass' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'UNAUTHORIZED');
    assert.equal(wrong.body.error.message, 'Sign in failed');
    const short = await call(api.base, '/api/login', { method: 'POST', body: { login: 'operator', password: 'x' } });
    assert.equal(short.status, 401);
    assert.equal(short.body.error.message, 'Sign in failed');
    const loggedIn = await call(api.base, '/api/login', { method: 'POST', body: { login: 'operator', password: 'operator' } });
    assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn.body));
    assert.deepEqual(loggedIn.body, { account: 'operator' });
    const cookie = sessionCookie(loggedIn);
    assert.match(loggedIn.headers.get('set-cookie') ?? '', /sid=.*HttpOnly/i);
    const session = await call(api.base, '/api/session', { cookie });
    assert.equal(session.status, 200);
    assert.deepEqual(session.body, { account: 'operator', provider: 'password' });
    const anon = await call(api.base, '/api/session');
    assert.equal(anon.status, 401);
    const out = await call(api.base, '/api/logout', { method: 'POST', cookie });
    assert.equal(out.status, 204);
    assert.match(out.headers.get('set-cookie') ?? '', /sid=/i);

    const again = await call(api.base, '/api/login', { method: 'POST', body: { login: 'operator', password: 'operator' } });
    const sid = sessionCookie(again);
    const created = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body: { repo: 'near/near-sdk-rs' }, cookie: sid });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.repo, 'near/near-sdk-rs');
    assert.equal(created.body.commitSha, SHA);
    assert.equal(created.body.status, 'queued');
    const mine = await call(api.base, '/api/requests?mine=1', { cookie: sid });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.ok(mine.body.requests.some((row: { requestId: string }) => row.requestId === created.body.requestId));
    const value = Buffer.from(JSON.stringify({ a: 'bob.mock', e: Date.now() + 3_600_000 })).toString('base64url');
    const other = await call(api.base, '/api/requests?mine=1', { cookie: `sid=${api.app.signCookie(value)}` });
    assert.equal(other.status, 200, JSON.stringify(other.body));
    assert.ok(!other.body.requests.some((row: { requestId: string }) => row.requestId === created.body.requestId));
    const row = await api.deps.pool.query<{ status: string; preset: string; models: string[] }>(
      'SELECT status, preset, models FROM request WHERE id = $1', [created.body.requestId]);
    assert.equal(row.rows[0]?.status, 'queued');
    assert.equal(row.rows[0]?.preset, 'account-nearai');
    assert.deepEqual(row.rows[0]?.models, ['deepseek-ai/DeepSeek-V4', 'Qwen/Qwen3.8-Max']);
    const jobs = await api.deps.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND singleton_key = $2', ['review', created.body.requestId]);
    assert.equal(jobs.rows[0]?.n, 1);

    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-local-job-')));
    const seen: string[][] = [];
    setLocalJobStarter((launch: LocalLaunch) => {
      seen.push([...launch.argv]);
      fs.writeFileSync(path.join(launch.outDir, 'report.pdf'), reportPdfBytes());
      void launch.mark('done', null);
    });
    try {
      const queued = await call(api.base, '/api/local/jobs', { method: 'POST', body: { path: dir } });
      assert.equal(queued.status, 201, JSON.stringify(queued.body));
      assert.equal(queued.body.kind, 'path');
      assert.equal(queued.body.status, 'queued');
      const argv = seen[0] ?? [];
      assert.ok(argv.includes('--repo'), argv.join(' '));
      assert.equal(argv.includes('--github'), false);
      assert.equal(argv.includes('--rpc'), false);
      assert.deepEqual(argv.filter((arg) => arg.startsWith('-')), ['--repo', '--reviewers', '--passes', '--tool-budget', '--out']);
      assert.equal(argv[argv.indexOf('--repo') + 1], dir);
      const id = queued.body.id as string;
      const view = await until(async () => {
        const reply = await call(api.base, `/api/local/jobs/${id}`);
        return reply.body?.pdfReady === true ? reply : null;
      });
      assert.equal(view.body.status, 'done');
      const pdf = await fetch(`${api.base}/api/local/jobs/${id}/report.pdf`);
      assert.equal(pdf.status, 200);
      assert.match(pdf.headers.get('content-type') ?? '', /^application\/pdf/);
      const bytes = Buffer.from(await pdf.arrayBuffer());
      assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
      // A job with the engine's live snapshot is served with its progress (the response schema is strict).
      const phases = ['prepare', 'tests', 'review', 'crosscheck', 'debate', 'adjudicate', 'general-review', 'report'];
      const row = await api.deps.pool.query<{ out_dir: string }>('SELECT out_dir FROM operator_job WHERE id = $1', [id]);
      const dirOut = row.rows[0]!.out_dir;
      fs.mkdirSync(path.join(dirOut, 'harness', 'host'), { recursive: true });
      fs.writeFileSync(path.join(dirOut, 'harness', 'host', 'progress.json'), JSON.stringify({
        version: 1, state: 'running', phase: 'review', percent: 30, startedAt: '2026-11-10T12:00:00.000Z', updatedAt: '2026-11-10T12:05:00.000Z', elapsedMs: 300_000,
        phases: phases.map((name, i) => ({ name, state: i < 2 ? 'done' : i === 2 ? 'running' : 'pending' })),
        reviewers: [{ id: 'cli-claude-opus', state: 'running', jobsDone: 0, jobs: 1, passes: 1 }],
      }));
      const live = await call(api.base, `/api/local/jobs/${id}`);
      assert.equal(live.status, 200, JSON.stringify(live.body));
      assert.equal(live.body.progress?.detail?.state, 'running');
    } finally {
      setLocalJobStarter(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('there is no operator panel: no key means no job, panel sources and extras are refused, and the operator key routes are gone', async () => {
    const cookieFor = (account: string) => `sid=${api.app.signCookie(Buffer.from(JSON.stringify({ a: account, e: Date.now() + 3_600_000 })).toString('base64url'))}`;
    const dave = cookieFor('dave.mock');
    const body = { repo: 'near/near-sdk-rs' };
    const noKey = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body, cookie: dave });
    assert.equal(noKey.status, 400, JSON.stringify(noKey.body));
    assert.equal(noKey.body.error.code, 'PRESET_NOT_ALLOWED');
    assert.match(noKey.body.error.message, /Save your NEAR AI Cloud key/);
    for (const bad of [{ ...body, source: 'panel' }, { ...body, models: ['opus'] }, { ...body, source: 'openrouter' }]) {
      const refused = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body: bad, cookie: dave });
      assert.equal(refused.status, 400, JSON.stringify(bad));
      assert.equal(refused.body.error.code, 'VALIDATION_ERROR', JSON.stringify(refused.body));
    }

    // The admin page keeps jobs; the operator provider-key routes are gone.
    assert.equal((await call(api.base, '/api/operator/activity', { headers: { authorization: admin } })).status, 200);
    assert.equal((await call(api.base, '/api/operator/providers', { headers: { authorization: admin } })).status, 404);
    assert.equal((await call(api.base, '/api/operator/providers', { method: 'PUT', body: { nearai: 'k' }, headers: { authorization: admin } })).status, 404);

    // There is no free-checks switch any more: everything is free on the account's own key.
    for (const [method, url] of [['POST', '/api/free/jobs'], ['GET', '/api/review-settings'], ['PUT', '/api/operator/settings']] as const) {
      assert.equal((await call(api.base, url, { method, body: method === 'GET' ? undefined : body, headers: { authorization: admin } })).status, 404, url);
    }
    const activity = await call(api.base, '/api/operator/activity', { headers: { authorization: admin } });
    assert.deepEqual(Object.keys(activity.body), ['jobs']);

    // A finished review left over from the removed panel cannot be continued: it has no account key to run on.
    const legacy = '0f0e0d0c-0b0a-4908-8706-050403020100';
    await insertRequest(api.deps.pool, {
      id: legacy, account: 'dave.mock', repo: 'near/near-sdk-rs', commitSha: SHA, preset: 'panel',
      now: new Date(), scope: 'full', models: null, pipelineMode: 'stage-1',
    });
    await api.deps.pool.query("UPDATE request SET status = 'done' WHERE id = $1", [legacy]);
    const advise = await call(api.base, `/api/dashboard/jobs/${legacy}/advise`, { method: 'POST', cookie: dave });
    assert.equal(advise.status, 400, JSON.stringify(advise.body));
    assert.equal(advise.body.error.code, 'PRESET_NOT_ALLOWED');
  });

  test('a NEAR AI review runs on the account\'s own key and models and never echoes the key', async () => {
    const cookieFor = (account: string) => `sid=${api.app.signCookie(Buffer.from(JSON.stringify({ a: account, e: Date.now() + 3_600_000 })).toString('base64url'))}`;
    const carol = cookieFor('carol.mock');
    const route = '/api/account/providers/nearai';
    assert.equal((await call(api.base, route)).status, 401);
    assert.equal((await call(api.base, route, { method: 'PUT', body: { key: 'x' } })).status, 401);
    assert.equal((await call(api.base, '/api/account/providers/local', { cookie: carol })).status, 400, 'only account-key providers are reachable');
    const empty = await call(api.base, route, { cookie: carol });
    assert.equal(empty.body.set, false);
    assert.deepEqual(empty.body.models, []);
    assert.equal(empty.body.label, 'NEAR AI Cloud');
    const all = await call(api.base, '/api/account/providers', { cookie: carol });
    assert.deepEqual(all.body.providers.map((p: { provider: string }) => p.provider), ['nearai']);
    const body = { repo: 'near/near-sdk-rs', source: 'nearai' };
    const noKey = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body, cookie: carol });
    assert.equal(noKey.body.error.code, 'PRESET_NOT_ALLOWED', JSON.stringify(noKey.body));
    assert.equal((await call(api.base, '/api/dashboard/jobs', { method: 'POST', body: { ...body, source: 'local' }, cookie: carol })).status, 400);
    const bad = await call(api.base, route, { method: 'PUT', body: { key: 'near-test-key-not-real-0000', models: ['not a model'] }, cookie: carol });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    const saved = await call(api.base, route, { method: 'PUT', body: { key: 'near-test-key-not-real-0000', models: ['deepseek-ai/DeepSeek-V4'] }, cookie: carol });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.set, true);
    assert.deepEqual(saved.body.models, ['deepseek-ai/DeepSeek-V4']);
    assert.ok(!JSON.stringify(saved.body).includes('near-test-key-not-real-0000'));
    const stored = await api.deps.pool.query<{ data: string }>('SELECT data FROM account_provider_key WHERE account = $1', ['carol.mock']);
    assert.ok(stored.rows[0] && !stored.rows[0].data.includes('near-test-key'), 'sealed at rest');
    assert.equal((await call(api.base, route, { cookie: cookieFor('erin.mock') })).body.set, false, 'another account sees none');
    const mixed = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body: { ...body, models: ['opus'] }, cookie: carol });
    assert.equal(mixed.status, 400, JSON.stringify(mixed.body));
    const created = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body, cookie: carol });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const row = await api.deps.pool.query<{ preset: string; models: string[] }>('SELECT preset, models FROM request WHERE id = $1', [created.body.requestId]);
    assert.deepEqual(row.rows[0], { preset: 'account-nearai', models: ['deepseek-ai/DeepSeek-V4'] });
    const cleared = await call(api.base, route, { method: 'PUT', body: { key: '' }, cookie: carol });
    assert.equal(cleared.body.set, false);
    assert.equal((await call(api.base, `${route}/models`, { cookie: carol })).status, 404);
  });
});
