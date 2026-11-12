// Dev/e2e only. Read side of the intake API: one request, the SSE progress
// stream, the account's list and the report index.
import { http, HttpResponse, sse } from 'msw';
import type { ProgressEvent, RequestStatusResponse } from '@/lib/api/schema.gen';
import { reportBase, settle } from '../chain';
import { clock, readState, stamp, type MockRequest } from '../db';
import { REVIEWERS, snapshotAt, STEP_MS } from '../state-machine';
import { apiError } from './intake';

const TERMINAL = new Set(['done', 'refunded']);

function find(id: string): MockRequest | undefined {
  return readState().requests.find((row) => row.id === id);
}

export async function statusOf(row: MockRequest): Promise<RequestStatusResponse> {
  const settled = await settle(row);
  const snapshot = snapshotAt(settled, clock.now());
  const body: RequestStatusResponse = { status: snapshot.status, createdAt: stamp(settled.createdAt) };
  if (settled.pipelineMode) body.pipelineMode = settled.pipelineMode;
  if (snapshot.progress) body.progress = snapshot.progress;
  if (snapshot.status === 'done') {
    const attestation = readState().attestations[settled.requestHash];
    body.reportUrl = `${reportBase(settled.id)}report.html`;
    if (attestation) body.reportSha256 = attestation.report_sha256;
    if (settled.attestTx) body.attestTx = settled.attestTx;
    if (settled.pipelineMode || settled.roundsCompleted) {
      const mode = settled.pipelineMode ?? 'full';
      const rounds = settled.roundsCompleted ?? (mode === 'full' ? 2 : 0);
      const nextRoundRequestIds = readState().requests.filter((item) => item.parentId === settled.id).map((item) => item.id);
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
  if (snapshot.status === 'refunded' && settled.refundTx) body.refundTx = settled.refundTx;
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

function paidReceipt(row: MockRequest, tx: string) {
  return { paid: { yocto: row.priceYocto, tx }, reviewers: [], check: { passed: 0, total: 0, byStatus: {} } };
}

const report = http.get<{ id: string }>('/api/reports/:id', async ({ params }) => {
  const stored = find(params.id);
  if (!stored) return apiError('REQUEST_NOT_FOUND', 404, 'Request not found');
  const status = await statusOf(stored);
  const row = find(params.id) ?? stored;
  if (status.status === 'refunded' && row.txHash && row.refundTx) {
    return HttpResponse.json({
      requestId: row.id,
      receipt: { ...paidReceipt(row, row.txHash), refund: { tx: row.refundTx, yocto: row.priceYocto } },
    });
  }
  const attestation = readState().attestations[row.requestHash];
  if (status.status !== 'done' || !attestation) return apiError('NOT_FOUND', 404, 'Report not published yet');
  const base = reportBase(row.id);
  return HttpResponse.json({
    requestId: row.id, reportUrl: `${base}report.html`, reportSha256: attestation.report_sha256,
    reviewers: [...REVIEWERS], generalReviewUrl: `${base}general-review.json`,
    attestation: {
      requestHash: attestation.request_hash, reportSha256: attestation.report_sha256, reportUri: attestation.report_uri,
      deployed: attestation.deployed, codeHash: attestation.code_hash, maxSeverity: attestation.max_severity,
      repo: attestation.repo, commit: attestation.commit, bindingConfirmed: attestation.binding_confirmed,
      blockHeight: attestation.block_height, blockTimestampMs: attestation.block_timestamp_ms,
    },
    ...(row.txHash && row.attestTx ? {
      receipt: {
        ...paidReceipt(row, row.txHash),
        attestation: { tx: row.attestTx, hash: attestation.report_sha256 },
      },
    } : {}),
  });
});

export const statusHandlers = [one, ...(typeof EventSource === 'undefined' ? [] : [eventsHandler()]), mine, report];
