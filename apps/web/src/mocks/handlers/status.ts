// Dev/e2e only. Read side of the intake API: one request, the SSE progress
// stream, the account's list and the report index.
import { http, HttpResponse, sse } from 'msw';
import type { ProgressEvent, RequestStatusResponse } from '@/lib/api/schema.gen';
import { clock, readState, stamp, type MockRequest } from '../db';
import { mockReportSha256, reportBase } from '../reports';
import { REVIEWERS, snapshotAt, STEP_MS } from '../state-machine';
import { apiError } from './intake';

const TERMINAL = new Set(['done', 'failed']);

function find(id: string): MockRequest | undefined {
  return readState().requests.find((row) => row.id === id);
}

export async function statusOf(row: MockRequest): Promise<RequestStatusResponse> {
  const snapshot = snapshotAt(row, clock.now());
  const body: RequestStatusResponse = { status: snapshot.status, createdAt: stamp(row.createdAt) };
  if (row.pipelineMode) body.pipelineMode = row.pipelineMode;
  if (snapshot.progress) body.progress = snapshot.progress;
  if (snapshot.status === 'done') {
    body.reportUrl = `${reportBase(row.id)}report.html`;
    body.reportSha256 = await mockReportSha256();
    if (row.pipelineMode || row.roundsCompleted) {
      const mode = row.pipelineMode ?? 'full';
      const rounds = row.roundsCompleted ?? (mode === 'full' ? 2 : 0);
      const nextRoundRequestIds = readState().requests.filter((item) => item.parentId === row.id).map((item) => item.id);
      body.pipeline = {
        pipelineMode: mode,
        currentStage: rounds > 0 ? 'stage-3-debate' : mode === 'stage-1' ? 'stage-1' : mode === 'step-by-step' ? 'stage-2-advice' : 'completed',
        noDebates: rounds === 0,
        roundsCompleted: rounds,
        canRunMoreRounds: rounds < 20,
        advice: {
          debateNeeded: rounds === 0,
          recommendedDepth: rounds === 0 ? 'shallow' : 'none',
          recommendedRounds: rounds === 0 ? 1 : 0,
          qualityRating: 'adequate',
          summary: rounds === 0 ? 'Stage 1 pass complete; 1 debate round recommended on disputed claims.' : `Completed ${rounds} debate round(s).`,
        },
        ...(nextRoundRequestIds.length > 0 ? { nextRoundRequestIds } : {}),
      };
    }
  }
  return body;
}

export function progressEvent(status: RequestStatusResponse): ProgressEvent {
  return { status: status.status, ...(status.progress ? { progress: status.progress } : {}), at: stamp(clock.now()) };
}

const one = http.get<{ id: string }>('/api/requests/:id', async ({ params }) => {
  const row = find(params.id);
  return row ? HttpResponse.json(await statusOf(row)) : apiError('REQUEST_NOT_FOUND', 404, 'Request not found');
});

// Emits one event per status/progress change; SSE_DROP errors the stream so the
// page falls back to polling. Built only where EventSource exists (browsers).
function eventsHandler() {
  return sse('/api/requests/:id/events', ({ client, params }) => {
    if (readState().controls.error === 'SSE_DROP') return client.error();
    let last = '';
    const timer = setInterval(() => {
      const row = find(String(params.id));
      if (!row) {
        clearInterval(timer);
        return client.close();
      }
      void statusOf(row).then((status) => {
        const key = JSON.stringify([status.status, status.progress]);
        if (key === last) return;
        last = key;
        client.send({ data: JSON.stringify(progressEvent(status)) });
        if (!TERMINAL.has(status.status)) return;
        clearInterval(timer);
        client.close();
      });
    }, STEP_MS / 3);
  });
}

const mine = http.get('/api/requests', async ({ request }) => {
  if (new URL(request.url).searchParams.get('mine') !== '1') return apiError('VALIDATION_ERROR', 400, 'mine=1 is required');
  const state = readState();
  if (!state.session) return apiError('UNAUTHORIZED', 401, 'Sign in required');
  const rows = state.requests.filter((row) => row.account === state.session);
  const requests = await Promise.all(rows.map(async (row) => ({
    requestId: row.id, repo: row.repo, status: (await statusOf(row)).status, createdAt: stamp(row.createdAt),
  })));
  return HttpResponse.json({ requests });
});

const report = http.get<{ id: string }>('/api/reports/:id', async ({ params }) => {
  const row = find(params.id);
  if (!row) return apiError('REQUEST_NOT_FOUND', 404, 'Request not found');
  const status = await statusOf(row);
  if (status.status !== 'done') return apiError('NOT_FOUND', 404, 'Report not published yet');
  const base = reportBase(row.id);
  return HttpResponse.json({
    requestId: row.id, reportUrl: `${base}report.html`, reportSha256: await mockReportSha256(),
    reviewers: [...REVIEWERS], generalReviewUrl: `${base}general-review.json`,
    repo: row.repo, maxSeverity: 'high', check: { passed: 3, total: 5 },
  });
});

export const statusHandlers = [one, ...(typeof EventSource === 'undefined' ? [] : [eventsHandler()]), mine, report];
