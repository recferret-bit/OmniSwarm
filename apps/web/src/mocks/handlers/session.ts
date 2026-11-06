// Dev/e2e only. Operator login, dashboard jobs and the request PDF.
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
  const body = (await request.json()) as { repo?: unknown } | null;
  const parsed = typeof body?.repo === 'string' ? parseRepoInput(body.repo) : null;
  if (!parsed) return apiError('REPO_INVALID', 400, 'Not a GitHub repository');
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

export const sessionHandlers = [login, logout, session, dashboardJob, requestPdf];
