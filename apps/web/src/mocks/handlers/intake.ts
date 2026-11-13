// Dev/e2e only. Challenge, follow-up debate steps and health. Responses follow
// intake-api.schema.json (vitest validates them). Reviews themselves are created
// by the dashboard job route (session.ts).
import { http, HttpResponse } from 'msw';
import type { ErrorCode } from '@/lib/api/schema.gen';
import { bytesToBase64 } from '@/lib/near/nep413';
import { clock, randomBytes, readState, stamp, updateState, type MockRequest } from '../db';
import { snapshotAt } from '../state-machine';

export const MOCK_COMMIT = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';

export function apiError(code: ErrorCode, status: number, message: string, retryable = false) {
  return HttpResponse.json({ error: { code, message, retryable } }, { status });
}

export function uuid(): string {
  const hex = [...randomBytes(16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const challenge = http.post('/api/challenge', () => {
  const nonce = bytesToBase64(randomBytes(32));
  const expiresAt = clock.now() + 5 * 60_000;
  updateState((state) => { state.nonces[nonce] = { expiresAt, used: false }; });
  return HttpResponse.json({ nonce, expiresAt: stamp(expiresAt) });
});

function followUp(parent: MockRequest, rounds: number): MockRequest {
  const now = clock.now();
  return {
    id: uuid(), account: parent.account, repo: parent.repo, commit: parent.commit, createdAt: now, startedAt: now,
    fails: false, pipelineMode: 'step-by-step', roundsCompleted: (parent.roundsCompleted ?? 0) + rounds, parentId: parent.id,
  };
}

const advise = http.post<{ id: string }>('/api/requests/:id/advise', async ({ params }) => {
  const state = readState();
  if (!state.session) return apiError('UNAUTHORIZED', 401, 'Sign in required');
  const parent = state.requests.find((item) => item.id === params.id && item.account === state.session);
  if (!parent) return apiError('REQUEST_NOT_FOUND', 404, 'Request not found');
  if (snapshotAt(parent, clock.now()).status !== 'done') return apiError('INVALID_TRANSITION', 409, 'Request is not done');
  const child = followUp(parent, 0);
  updateState((next) => { next.requests.unshift(child); });
  return HttpResponse.json({
    requestId: child.id, parentRequestId: parent.id, repo: child.repo, commitSha: child.commit, rounds: 0, status: 'queued',
  }, { status: 201 });
});

const debate = http.post<{ id: string }>('/api/requests/:id/debate', async ({ params, request }) => {
  const state = readState();
  if (!state.session) return apiError('UNAUTHORIZED', 401, 'Sign in required');
  const parent = state.requests.find((item) => item.id === params.id && item.account === state.session);
  if (!parent) return apiError('REQUEST_NOT_FOUND', 404, 'Request not found');
  if (snapshotAt(parent, clock.now()).status !== 'done') return apiError('INVALID_TRANSITION', 409, 'Request is not done');
  const body = (await request.json().catch(() => ({}))) as { rounds?: number };
  const rounds = typeof body?.rounds === 'number' && Number.isInteger(body.rounds) && body.rounds >= 1 && body.rounds <= 5 ? body.rounds : 1;
  const child = followUp(parent, rounds);
  updateState((next) => { next.requests.unshift(child); });
  return HttpResponse.json({
    requestId: child.id, parentRequestId: parent.id, repo: child.repo, commitSha: child.commit, rounds, status: 'queued',
  }, { status: 201 });
});

const health = http.get('/api/health', () => HttpResponse.json({ ok: true, queueDepth: readState().requests.length, workers: 1 }));

export const intakeHandlers = [challenge, advise, debate, health];
