// Dev/e2e only. Operator login, dashboard jobs and the request PDF.
// A dashboard job runs only on the account's own NEAR AI Cloud key (source "nearai"), as the API requires.
// Dashboard jobs set paidAt so snapshotAt walks queued -> running -> done.
// txHash stays null: this is not a chain payment.
import { http, HttpResponse } from 'msw';
import { parseRepoInput } from '@/lib/repo';
import { clock, randomBytes, readState, updateState, type MockRequest } from '../db';
import { snapshotAt } from '../state-machine';
import { apiError, MOCK_COMMIT, uuid } from './intake';
import { pdfResponse } from './pdf';

function sha256Hex(): string {
  return [...randomBytes(32)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const login = http.post('/api/login', async ({ request }) => {
  const body = (await request.json()) as { login?: unknown; password?: unknown } | null;
  if (body?.login !== 'operator' || body.password !== 'operator') return apiError('UNAUTHORIZED', 401, 'Sign in failed');
  updateState((state) => { state.session = 'operator'; });
  return HttpResponse.json({ account: 'operator' });
});

const logout = http.post('/api/logout', () => {
  updateState((state) => { state.session = null; });
  return new HttpResponse(null, { status: 204 });
});

const session = http.get('/api/session', () => {
  const account = readState().session;
  if (!account) return apiError('UNAUTHORIZED', 401, 'Sign in required');
  return HttpResponse.json({ account });
});

const dashboardJob = http.post('/api/dashboard/jobs', async ({ request }) => {
  const account = readState().session;
  if (!account) return apiError('UNAUTHORIZED', 401, 'Sign in required');
  const body = (await request.json()) as { repo?: unknown; source?: unknown } | null;
  const parsed = typeof body?.repo === 'string' ? parseRepoInput(body.repo) : null;
  if (!parsed) return apiError('REPO_INVALID', 400, 'Not a GitHub repository');
  if (body?.source !== 'nearai') return apiError('VALIDATION_ERROR', 400, 'A review runs on your own NEAR AI Cloud key: send source "nearai"');
  const key = own.nearai;
  if (!key?.set || key.models.length === 0) return apiError('VALIDATION_ERROR', 400, 'Save your NEAR AI Cloud key and at least one model first');
  const row: MockRequest = {
    id: uuid(), account, repo: parsed.repo, commit: MOCK_COMMIT, deployed: null, requestHash: sha256Hex(),
    priceYocto: '0', createdAt: clock.now(), paidAt: clock.now(), txHash: null,
    fails: false, attestTx: null, refundTx: null,
  };
  updateState((state) => { state.requests.unshift(row); });
  return HttpResponse.json({ requestId: row.id, repo: parsed.repo, commitSha: MOCK_COMMIT, status: 'queued' }, { status: 201 });
});

const requestPdf = http.get<{ id: string }>('/api/requests/:id/report.pdf', ({ params }) => {
  const state = readState();
  const row = state.requests.find((item) => item.id === params.id);
  if (!row || row.account !== state.session || snapshotAt(row, clock.now()).status !== 'done') {
    return apiError('NOT_FOUND', 404, 'Request not found');
  }
  return pdfResponse();
});

// One own key per mock session and provider (catalog providers that take account keys). The key itself is dropped.
const own: Record<string, { set: boolean; fingerprint: string | null; models: string[] }> = {};
const view = (provider: string) => ({
  provider, label: provider === 'nearai' ? 'NEAR AI Cloud' : provider, set: false, fingerprint: null, models: [] as string[],
  dataPolicy: 'Reviewed source is sent to this provider.', signedRequests: false, ...own[provider],
});
const ownList = http.get('/api/account/providers', () => (readState().session ? HttpResponse.json({ providers: [view('nearai')] }) : apiError('UNAUTHORIZED', 401, 'Sign in required')));
const ownPut = http.put('/api/account/providers/:provider', async ({ request, params }) => {
  if (!readState().session) return apiError('UNAUTHORIZED', 401, 'Sign in required');
  const provider = String(params.provider);
  const body = (await request.json()) as { key?: string; models?: string[] };
  const current = view(provider);
  own[provider] = {
    set: body.key === undefined ? current.set : body.key !== '',
    fingerprint: body.key === undefined ? current.fingerprint : body.key ? 'mock0000' : null,
    models: body.models ?? current.models,
  };
  return HttpResponse.json(view(provider));
});
const ownModels = http.get('/api/account/providers/:provider/models', ({ params }) => (view(String(params.provider)).set
  ? HttpResponse.json({ source: 'live', models: ['deepseek-ai/DeepSeek-V4', 'Qwen/Qwen3.8-Max', 'meta-llama/Llama-5-70B', 'openai/gpt-oss-120b'] })
  : apiError('NOT_FOUND', 404, 'Save your key first')));

export const sessionHandlers = [login, logout, session, dashboardJob, requestPdf, ownList, ownPut, ownModels];
