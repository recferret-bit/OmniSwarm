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
import { clock, readState } from './db';
import { progressEvent, statusOf } from './handlers/status';
import { DONE_AFTER_MS, snapshotAt } from './state-machine';
import { createMockConnector } from './wallet';

useMockApi();

function expectValid(def: string, value: unknown) {
  const result = validate(`intake-api#${def}`, value);
  expect(result.errors).toEqual([]);
}

async function paidRequest() {
  const connector = createMockConnector();
  const store = createRequestFlowStore({ api, connector: async () => connector, sleep: async () => undefined, now: Date.now, storage: () => sessionStorage });
  await store.getState().requestQuote('near/near-sdk-rs');
  expectValid('quote-response', store.getState().quote);
  await store.getState().sign('alice.testnet');
  expectValid('create-request-response', store.getState().request);
  await store.getState().pay();
  return store.getState().request!;
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
});
