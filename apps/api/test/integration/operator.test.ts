// Password dashboard and loopback local jobs. Skips without DATABASE_URL, like the other integration tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { setLocalJobStarter, type LocalLaunch } from '../../src/modules/operator/local-audit.ts';
import { writeProviderSecrets } from '../../src/modules/providers/secrets.ts';
import { reportPdfBytes } from '../../src/shared/report-pdf.ts';
import { call, sessionCookie } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { SHA, migratedDb, startApi, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

describe('operator dashboard and local jobs', NEEDS_DB, () => {
  let t: TestDb;
  let api: ApiStack;
  let secretsFile: string;
  before(async () => {
    // A dashboard job needs both provider keys on the admin page (dashboard.service.ts); seal two fake ones.
    secretsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-operator-keys-')), 'provider-secrets.json');
    t = await migratedDb('operator', { PROVIDER_SECRETS_FILE: secretsFile });
    writeProviderSecrets(secretsFile, t.env.SESSION_SECRET!, { zai: 'zai-test-key-not-a-real-key-000000', openrouter: 'or-test-key-not-a-real-key-000000' });
    api = await startApi(t.env);
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
    assert.deepEqual(session.body, { account: 'operator' });
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
    const row = await api.deps.pool.query<{ status: string; request_hash: string }>('SELECT status, request_hash FROM request WHERE id = $1', [created.body.requestId]);
    assert.equal(row.rows[0]?.status, 'queued');
    const jobs = await api.deps.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND singleton_key = $2', ['review', row.rows[0]?.request_hash]);
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

  test('a dashboard job is refused until both provider keys are set, and runs again once they are', async () => {
    const login = await call(api.base, '/api/login', { method: 'POST', body: { login: 'operator', password: 'operator' } });
    const cookie = sessionCookie(login);
    const body = { repo: 'near/near-sdk-rs' };
    const keys = { zai: 'zai-test-key-not-a-real-key-000000', openrouter: 'or-test-key-not-a-real-key-000000' };
    const secret = t.env.SESSION_SECRET!;
    try {
      for (const missing of ['zai', 'openrouter'] as const) {
        writeProviderSecrets(secretsFile, secret, { [missing]: '' });
        const refused = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body, cookie });
        assert.equal(refused.status, 400, `${missing} missing`);
        assert.equal(refused.body.error.code, 'PRESET_NOT_ALLOWED');
        assert.match(refused.body.error.message, /Set the Z\.AI and OpenRouter keys on the admin page/);
        writeProviderSecrets(secretsFile, secret, keys);
      }
      writeProviderSecrets(secretsFile, secret, { zai: '', openrouter: '' });
      assert.equal((await call(api.base, '/api/dashboard/jobs', { method: 'POST', body, cookie })).body.error.code, 'PRESET_NOT_ALLOWED', 'neither key set');
    } finally {
      writeProviderSecrets(secretsFile, secret, keys);
    }
    // With both keys back the key gate passes. The account already has a job in flight from the first test, so
    // the request now meets the capacity limit (409) instead of the key refusal.
    const again = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body, cookie });
    assert.notEqual(again.body?.error?.code, 'PRESET_NOT_ALLOWED', JSON.stringify(again.body));
    assert.ok([201, 409].includes(again.status), JSON.stringify(again.body));
  });
  test('a NEAR AI review runs on the account\'s own key and models, with no operator keys, and never echoes the key', async () => {
    const secret = t.env.SESSION_SECRET!;
    const cookieFor = (account: string) => `sid=${api.app.signCookie(Buffer.from(JSON.stringify({ a: account, e: Date.now() + 3_600_000 })).toString('base64url'))}`;
    const carol = cookieFor('carol.mock');
    const route = '/api/account/providers/nearai';
    assert.equal((await call(api.base, route)).status, 401);
    assert.equal((await call(api.base, route, { method: 'PUT', body: { key: 'x' } })).status, 401);
    assert.equal((await call(api.base, '/api/account/providers/zai', { cookie: carol })).status, 400, 'zai takes operator keys only');
    const empty = await call(api.base, route, { cookie: carol });
    assert.equal(empty.body.set, false);
    assert.deepEqual(empty.body.models, []);
    assert.equal(empty.body.label, 'NEAR AI Cloud');
    const all = await call(api.base, '/api/account/providers', { cookie: carol });
    assert.deepEqual(all.body.providers.map((p: { provider: string }) => p.provider), ['nearai']);
    const body = { repo: 'near/near-sdk-rs', source: 'nearai' };
    const noKey = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body, cookie: carol });
    assert.equal(noKey.body.error.code, 'PRESET_NOT_ALLOWED', JSON.stringify(noKey.body));
    assert.equal((await call(api.base, '/api/dashboard/jobs', { method: 'POST', body: { ...body, source: 'zai' }, cookie: carol })).status, 400);
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
    // The operator's Z.AI and OpenRouter keys are not needed for a NEAR AI review.
    writeProviderSecrets(secretsFile, secret, { zai: '', openrouter: '' });
    try {
      const created = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body, cookie: carol });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const row = await api.deps.pool.query<{ preset: string; models: string[] }>('SELECT preset, models FROM request WHERE id = $1', [created.body.requestId]);
      assert.deepEqual(row.rows[0], { preset: 'account-nearai', models: ['deepseek-ai/DeepSeek-V4'] });
      // The panel path still needs the operator keys.
      const panel = await call(api.base, '/api/dashboard/jobs', { method: 'POST', body: { repo: 'near/near-sdk-rs' }, cookie: cookieFor('erin.mock') });
      assert.equal(panel.body.error.code, 'PRESET_NOT_ALLOWED');
    } finally {
      writeProviderSecrets(secretsFile, secret, { zai: 'zai-test-key-not-a-real-key-000000', openrouter: 'or-test-key-not-a-real-key-000000' });
    }
    const cleared = await call(api.base, route, { method: 'PUT', body: { key: '' }, cookie: carol });
    assert.equal(cleared.body.set, false);
    assert.equal((await call(api.base, `${route}/models`, { cookie: carol })).status, 404);
  });
});
