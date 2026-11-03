import { describe, expect, it, vi } from 'vitest';
import type { Api } from '@/lib/api/client';
import type { RequestStatusResponse } from '@/lib/api/schema.gen';
import { createRequestStatusStore, phasesSeen, POLL_MS, reviewerRows } from './request-status';

class FakeStream {
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close() { this.closed = true; }
  emit(data: object) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>); }
}

function setup(statuses: RequestStatusResponse[]) {
  const getRequest = vi.fn(async () => statuses.shift() ?? { status: 'done' as const, createdAt: '2026-11-03T00:00:00Z' });
  const stream = new FakeStream();
  let tick: (() => void) | null = null;
  const store = createRequestStatusStore({
    api: { getRequest } as unknown as Api,
    openStream: () => stream as unknown as EventSource,
    setInterval: (fn, ms) => { expect(ms).toBe(POLL_MS); tick = fn; return 1; },
    clearInterval: () => { tick = null; },
  });
  return { store, stream, getRequest, tick: () => tick?.(), polling: () => tick !== null };
}

const at = '2026-11-03T00:00:01Z';
const running = { status: 'running' as const, createdAt: '2026-11-03T00:00:00Z' };

describe('request status store', () => {
  it('applies SSE events and fetches the full status once terminal', async () => {
    const { store, stream, getRequest } = setup([running, { status: 'done', createdAt: running.createdAt, reportUrl: 'https://r.example/x/report.html' }]);
    const stop = store.getState().watch('id-1');
    await vi.waitFor(() => expect(store.getState().byId['id-1']?.status?.status).toBe('running'));
    stream.emit({ status: 'running', progress: { phase: 'review', reviewer: 'a', pass: 1 }, at });
    stream.emit({ status: 'running', progress: { phase: 'review', reviewer: 'a', pass: 2 }, at });
    expect(store.getState().byId['id-1']?.mode).toBe('live');
    stream.emit({ status: 'done', at });
    await vi.waitFor(() => expect(store.getState().byId['id-1']?.status?.reportUrl).toContain('report.html'));
    expect(getRequest).toHaveBeenCalledTimes(2);
    expect(stream.closed).toBe(true);
    expect(reviewerRows(store.getState().byId['id-1']!.events)).toEqual([{ reviewer: 'a', pass: 2 }]);
    stop();
  });

  it('falls back to polling every 5 s when the stream errors, keeps going past failed, stops at refunded', async () => {
    const failed = { status: 'failed' as const, createdAt: running.createdAt };
    const { store, stream, tick, polling } = setup([running, failed, { status: 'refunded', createdAt: running.createdAt, refundTx: 'tx' }]);
    store.getState().watch('id-2');
    await vi.waitFor(() => expect(stream.onerror).not.toBeNull());
    stream.onerror!();
    expect(store.getState().byId['id-2']?.mode).toBe('polling');
    expect(polling()).toBe(true);
    tick();
    await vi.waitFor(() => expect(store.getState().byId['id-2']?.status?.status).toBe('failed'));
    expect(polling()).toBe(true);
    tick();
    await vi.waitFor(() => expect(store.getState().byId['id-2']?.mode).toBe('closed'));
    expect(store.getState().byId['id-2']?.status?.refundTx).toBe('tx');
    expect(polling()).toBe(false);
  });

  it('lists phases in first-seen order', () => {
    expect(phasesSeen([
      { status: 'running', progress: { phase: 'prepare' }, at },
      { status: 'running', progress: { phase: 'review' }, at },
      { status: 'running', progress: { phase: 'review' }, at },
      { status: 'running', progress: { phase: 'debate' }, at },
    ])).toEqual(['prepare', 'review', 'debate']);
  });
});
