// The mocks must speak the real contract: every mock response validates against
// intake-api.schema.json with the shared validator, and a request walks every
// status in order.
import { validate } from '@omniswarm/schemas';
import { describe, expect, it } from 'vitest';
import { api } from '@/lib/api/client';
import { getAttestation } from '@/lib/near/rpc';
import { createRequestFlowStore } from '@/stores/request-flow';
import { useMockApi } from '@/test/msw';
import { setMockError } from './controls';
import { clock, readState, updateState } from './db';
import { progressEvent, statusOf } from './handlers/status';
import { DONE_AFTER_MS, snapshotAt } from './state-machine';
import { createMockConnector } from './wallet';

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

async function paidRequest() {
  const connector = createMockConnector();
  const store = createRequestFlowStore({ api, connector: async () => connector, sleep: async () => undefined, now: Date.now, storage: () => sessionStorage });
  await store.getState().requestQuote('near/near-sdk-rs');
  expectValid('quote-response', store.getState().quote);
  await store.getState().sign('alice.testnet');
  expectValid('create-request-response', store.getState().request);
  await store.getState().pay();
  return { ...store.getState().request!, txHash: store.getState().txHash! };
}

describe('mock intake API', () => {
  it('serves schema-valid challenge, health and error responses', async () => {
    expectValid('challenge-response', await api.challenge());
    expectValid('health-response', await api.health());
    setMockError('QUEUE_FULL');
    const response = await fetch('/api/quote', { method: 'POST', body: JSON.stringify({ repoUrl: 'near/x', network: 'testnet' }) });
    expect(response.status).toBe(503);
    expectValid('error-response', await response.json());
  });

  it('walks awaiting_payment -> queued -> running -> publishing -> done and attests the report', async () => {
    const request = await paidRequest();
    const row = readState().requests[0]!;
    const seen: string[] = [];
    const real = clock.now;
    try {
      for (let t = row.paidAt!; t <= row.paidAt! + DONE_AFTER_MS + 300; t += 300) {
        clock.now = () => t;
        const status = await statusOf(readState().requests[0]!);
        expectValid('request-status-response', status);
        expectValid('progress-event', progressEvent(status));
        if (seen[seen.length - 1] !== status.status) seen.push(status.status);
      }
      expect(seen).toEqual(['queued', 'running', 'publishing', 'done']);
      expect(snapshotAt({ ...row, paidAt: null }, 0).status).toBe('awaiting_payment');
      const report = await api.getReport(request.requestId);
      expectValid('report-index-response', report);
      expect((await getAttestation(request.requestHash))?.report_sha256).toBe(report.reportSha256);
      expectValid('request-list-response', await api.listMine());
    } finally {
      clock.now = real;
    }
  });

  it('answers a payment replay with the current status and rank, and refuses a tx used elsewhere', async () => {
    const request = await paidRequest();
    const paidAt = readState().requests[0]!.paidAt!;
    const replay = await withClock(paidAt, () => api.confirmPayment(request.requestId, { txHash: request.txHash }));
    expectValid('payment-response', replay);
    expect(replay).toEqual({ status: 'queued', position: 1 });
    const later = await withClock(paidAt + DONE_AFTER_MS, () => api.confirmPayment(request.requestId, { txHash: request.txHash }));
    expectValid('payment-response', later);
    expect(later).toEqual({ status: 'done', position: null });
    const other = { ...readState().requests[0]!, id: '00000000-0000-4000-a000-000000000001', paidAt: null, txHash: null };
    updateState((state) => { state.requests.unshift(other); });
    const reused = await post(`/api/requests/${other.id}/payment`, { txHash: request.txHash });
    expect(reused.status).toBe(409);
    expectValid('error-response', reused.body);
    expect(reused.body).toMatchObject({ error: { code: 'TX_ALREADY_USED' } });
  });

  it('serves the public ledger without account ids', async () => {
    const request = await paidRequest();
    const paidAt = readState().requests[0]!.paidAt!;
    const ledger = await withClock(paidAt + DONE_AFTER_MS, async () => (await fetch('/api/ledger')).json());
    expectValid('ledger-response', ledger);
    expect(ledger.entries).toEqual([expect.objectContaining({ requestId: request.requestId, status: 'done', paidYocto: request.priceYocto, reviewers: 3 })]);
    expect(ledger.totals).toEqual({ requests: 1, salesYocto: request.priceYocto, refundedYocto: '0', modelCostUsd: 0 });
    expect(JSON.stringify(ledger)).not.toContain('alice.testnet');
  });

  it('serves 404 for a report that is not published', async () => {
    const request = await paidRequest();
    const early = await fetch(`/api/reports/${request.requestId}`);
    expect(early.status).toBe(404);
    expectValid('error-response', await early.json());
    const unknown = await fetch('/api/reports/00000000-0000-4000-a000-000000000000');
    expect(await unknown.json()).toMatchObject({ error: { code: 'REQUEST_NOT_FOUND' } });
  });

  it('queues guard reports with the schema rules and keeps one open report per account', async () => {
    const report = { account: 'phish.testnet', evidenceUrl: 'https://evidence.example/1', reason: 'drains approvals' };
    const anonymous = await post('/api/guard/reports', report);
    expect(anonymous.status).toBe(401);
    expectValid('error-response', anonymous.body);
    await paidRequest();
    const cases = [
      report, { ...report, reason: 'x'.repeat(280) }, { ...report, reason: 'x'.repeat(281) }, { ...report, reason: '   ' },
      { ...report, reason: 'line\nbreak' }, { ...report, evidenceUrl: 'http://evidence.example' }, { ...report, extra: 1 },
    ];
    for (const body of cases) {
      const response = await post('/api/guard/reports', body);
      expect(response.status).toBe(validate('intake-api#guard-report-request', body).ok ? 202 : 400);
      expectValid(response.status === 202 ? 'guard-report-response' : 'error-response', response.body);
    }
    const first = (await post('/api/guard/reports', report)).body as { reportId: string };
    const again = (await post('/api/guard/reports', { ...report, reason: 'resubmitted' })).body as { reportId: string };
    expect(again.reportId).toBe(first.reportId);
  });
});
