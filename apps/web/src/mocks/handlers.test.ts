// The mocks must speak the real contract: every mock response validates against
// intake-api.schema.json with the shared validator, and a request walks every
// status in order.
import { validate } from '@omniswarm/schemas';
import { describe, expect, it } from 'vitest';
import { api } from '@/lib/api/client';
import { useMockApi } from '@/test/msw';
import { setMockError } from './controls';
import { clock, readState } from './db';
import { MOCK_COMMIT } from './handlers/intake';
import { progressEvent, statusOf } from './handlers/status';
import { DONE_AFTER_MS } from './state-machine';
import { mockReportSha256 } from './reports';

useMockApi();

function expectValid(def: string, value: unknown) {
  const result = validate(`intake-api#${def}`, value);
  expect(result.errors).toEqual([]);
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as unknown };
}

async function withClock<T>(at: number, run: () => Promise<T>): Promise<T> {
  const real = clock.now;
  clock.now = () => at;
  try {
    return await run();
  } finally {
    clock.now = real;
  }
}

async function startedJob() {
  expect(await api.login({ login: 'operator', password: 'operator' })).toEqual({ account: 'operator' });
  await api.saveAccountKey('nearai', { key: 'near-test-key', models: ['deepseek-ai/DeepSeek-V4'] });
  const created = await post('/api/dashboard/jobs', { repo: 'near/near-sdk-rs', source: 'nearai' });
  expect(created.status).toBe(201);
  return created.body as { requestId: string };
}

describe('mock intake API', () => {
  it('serves schema-valid challenge, health and error responses', async () => {
    expectValid('challenge-response', await api.challenge());
    expectValid('health-response', await api.health());
    await api.login({ login: 'operator', password: 'operator' });
    setMockError('QUEUE_FULL');
    const response = await post('/api/dashboard/jobs', { repo: 'near/x', source: 'nearai' });
    expect(response.status).toBe(503);
    expectValid('error-response', response.body);
  });

  it('walks queued -> running -> publishing -> done and serves the report hash', async () => {
    const request = await startedJob();
    const row = readState().requests[0]!;
    const seen: string[] = [];
    const real = clock.now;
    try {
      for (let t = row.startedAt; t <= row.startedAt + DONE_AFTER_MS + 300; t += 300) {
        clock.now = () => t;
        const status = await statusOf(readState().requests[0]!);
        expectValid('request-status-response', status);
        expectValid('progress-event', progressEvent(status));
        if (seen[seen.length - 1] !== status.status) seen.push(status.status);
      }
      expect(seen).toEqual(['queued', 'running', 'publishing', 'done']);
      const report = await api.getReport(request.requestId);
      expectValid('report-index-response', report);
      expect(report.reportSha256).toBe(await mockReportSha256());
      expect(report).toMatchObject({ repo: 'near/near-sdk-rs', maxSeverity: 'high' });
      expectValid('request-list-response', await api.listMine());
    } finally {
      clock.now = real;
    }
  });

  it('ends a REVIEW_FAILED job at failed', async () => {
    await api.login({ login: 'operator', password: 'operator' });
    await api.saveAccountKey('nearai', { key: 'near-test-key', models: ['deepseek-ai/DeepSeek-V4'] });
    setMockError('REVIEW_FAILED');
    await post('/api/dashboard/jobs', { repo: 'near/near-sdk-rs', source: 'nearai' });
    const row = readState().requests[0]!;
    expect(row.fails).toBe(true);
    const status = await withClock(row.startedAt + DONE_AFTER_MS, () => statusOf(readState().requests[0]!));
    expect(status.status).toBe('failed');
    expectValid('request-status-response', status);
  });

  it('serves 404 for a report that is not published', async () => {
    const request = await startedJob();
    const early = await fetch(`/api/reports/${request.requestId}`);
    expect(early.status).toBe(404);
    expectValid('error-response', await early.json());
    const unknown = await fetch('/api/reports/00000000-0000-4000-a000-000000000000');
    expect(await unknown.json()).toMatchObject({ error: { code: 'REQUEST_NOT_FOUND' } });
  });

  it('signs in operator/operator, rejects a wrong password, and lists the dashboard job for that session', async () => {
    const denied = await post('/api/dashboard/jobs', { repo: 'near/near-sdk-rs' });
    expect(denied.status).toBe(401);
    expectValid('error-response', denied.body);

    const bad = await post('/api/login', { login: 'operator', password: 'nope' });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Sign in failed', retryable: false } });
    expect(readState().session).toBeNull();

    expect(await api.login({ login: 'operator', password: 'operator' })).toEqual({ account: 'operator' });
    expect(readState().session).toBe('operator');
    expect(await (await fetch('/api/session')).json()).toEqual({ account: 'operator' });

    const invalid = await post('/api/dashboard/jobs', { repo: 'not a repo' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: { code: 'REPO_INVALID' } });

    // No hosted panel: a job names the account's own NEAR AI key, and that key needs a model first.
    const panel = await post('/api/dashboard/jobs', { repo: 'near/near-sdk-rs', models: ['opus'] });
    expect(panel.status).toBe(400);
    expect(panel.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await api.saveAccountKey('nearai', { key: 'near-test-key' });
    const noModel = await post('/api/dashboard/jobs', { repo: 'near/near-sdk-rs', source: 'nearai' });
    expect(noModel.status).toBe(400);
    expect(noModel.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect((await api.listProviderModels('nearai')).models).toContain('deepseek-ai/DeepSeek-V4');
    await api.saveAccountKey('nearai', { models: ['deepseek-ai/DeepSeek-V4'] });

    let requestId = '';
    await withClock(1_700_000_000_000, async () => {
      const created = await post('/api/dashboard/jobs', { repo: 'https://github.com/near/near-sdk-rs', source: 'nearai' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ repo: 'near/near-sdk-rs', commitSha: MOCK_COMMIT, status: 'queued' });
      requestId = (created.body as { requestId: string }).requestId;
      const mine = await api.listMine();
      expectValid('request-list-response', mine);
      expect(mine.requests).toEqual([expect.objectContaining({ requestId, repo: 'near/near-sdk-rs', status: 'queued' })]);
      const early = await fetch(`/api/requests/${requestId}/report.pdf`);
      expect(early.status).toBe(404);
      expectValid('error-response', await early.json());
    });

    const pdf = await withClock(1_700_000_000_000 + DONE_AFTER_MS, () => fetch(`/api/requests/${requestId}/report.pdf`));
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
    const bytes = await pdf.text();
    expect(bytes.startsWith('%PDF-1.1')).toBe(true);
    expect(bytes).toContain('OmniSwarm report');

    await api.logout();
    expect(readState().session).toBeNull();
    const hidden = await withClock(1_700_000_000_000 + DONE_AFTER_MS, () => fetch(`/api/requests/${requestId}/report.pdf`));
    expect(hidden.status).toBe(404);
  });

  it('accepts exactly one absolute path or github repo and serves the local pdf', async () => {
    const neither = await post('/api/local/jobs', {});
    expect(neither.status).toBe(400);
    expect(neither.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    const both = await post('/api/local/jobs', { path: '/tmp/repo', github: 'near/near-sdk-rs' });
    expect(both.status).toBe(400);
    const relative = await post('/api/local/jobs', { path: 'tmp/repo' });
    expect(relative.status).toBe(400);
    const badRepo = await post('/api/local/jobs', { github: 'not a repo' });
    expect(badRepo.status).toBe(400);
    expect(badRepo.body).toMatchObject({ error: { code: 'REPO_INVALID' } });

    const pathJob = await post('/api/local/jobs', { path: '/tmp/repo' });
    expect(pathJob.status).toBe(201);
    expect(pathJob.body).toMatchObject({ kind: 'path', source: '/tmp/repo', status: 'done' });
    const pathId = (pathJob.body as { id: string }).id;
    const githubJob = await post('/api/local/jobs', { github: 'https://github.com/near/near-sdk-rs@main' });
    expect(githubJob.status).toBe(201);
    expect(githubJob.body).toMatchObject({ kind: 'github', source: 'near/near-sdk-rs', status: 'done' });
    const githubId = (githubJob.body as { id: string }).id;

    const detail = await (await fetch(`/api/local/jobs/${githubId}`)).json();
    expect(detail).toMatchObject({ kind: 'github', source: 'near/near-sdk-rs', ref: 'main', commitSha: MOCK_COMMIT, status: 'done', pdfReady: true, error: null });
    const listed = await (await fetch('/api/local/jobs')).json() as { jobs: { id: string; createdAt: string }[] };
    expect(listed.jobs.map((job) => job.id)).toEqual([githubId, pathId]);
    expect(listed.jobs[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const pdf = await fetch(`/api/local/jobs/${pathId}/report.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
    const bytes = await pdf.text();
    expect(bytes.startsWith('%PDF-1.1')).toBe(true);
    expect(bytes).toContain('OmniSwarm report');
    const missing = await fetch('/api/local/jobs/00000000-0000-4000-a000-000000000000/report.pdf');
    expect(missing.status).toBe(404);
    expectValid('error-response', await missing.json());
  });
});
