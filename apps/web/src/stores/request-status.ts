// Live status of one request (W11-14): SSE on /api/requests/:id/events, falling
// back to polling GET /api/requests/:id every 5 s when the stream errors.
import { create } from 'zustand';
import { api as defaultApi, eventsUrl, type Api } from '@/lib/api/client';
import { toAppError, type AppErrorCode } from '@/lib/api/errors';
import type { ProgressEvent, RequestStatusResponse, Status } from '@/lib/api/schema.gen';

export const POLL_MS = 5_000;
export const TERMINAL: readonly Status[] = ['done', 'failed'];
export type LiveMode = 'connecting' | 'live' | 'polling' | 'closed';

export interface RequestView {
  status: RequestStatusResponse | null;
  events: ProgressEvent[];
  mode: LiveMode;
  error: AppErrorCode | null;
}

export interface RequestStatusState {
  byId: Record<string, RequestView>;
  watch(id: string): () => void;
}

interface StatusDeps {
  api: Api;
  openStream: ((url: string) => EventSource) | null;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

const EMPTY: RequestView = { status: null, events: [], mode: 'connecting', error: null };

export function createRequestStatusStore(deps: StatusDeps) {
  return create<RequestStatusState>()((set, get) => {
    const patch = (id: string, change: Partial<RequestView>) =>
      set((state) => ({ byId: { ...state.byId, [id]: { ...(state.byId[id] ?? EMPTY), ...change } } }));
    const isTerminal = (id: string) => TERMINAL.includes(get().byId[id]?.status?.status as Status);

    return {
      byId: {},
      watch(id) {
        let stream: EventSource | null = null;
        let timer: unknown = null;
        let stopped = false;
        const stop = () => {
          stopped = true;
          stream?.close();
          if (timer !== null) deps.clearInterval(timer);
        };
        const refresh = async () => {
          try {
            patch(id, { status: await deps.api.getRequest(id), error: null });
          } catch (error) {
            patch(id, { error: toAppError(error).code });
          }
          if (isTerminal(id)) {
            patch(id, { mode: 'closed' });
            stop();
          }
        };
        const startPolling = () => {
          if (stopped || timer !== null) return;
          stream?.close();
          patch(id, { mode: 'polling' });
          timer = deps.setInterval(() => void refresh(), POLL_MS);
        };
        const onEvent = (message: MessageEvent<string>) => {
          const event = JSON.parse(message.data) as ProgressEvent;
          const view = get().byId[id] ?? EMPTY;
          // A status-only event (sent on every connect, after the replayed rows) keeps the progress already shown.
          const status = view.status ? { ...view.status, status: event.status, progress: event.progress ?? view.status.progress } : null;
          patch(id, { mode: 'live', events: [...view.events, event], ...(status ? { status } : {}) });
          // The terminal GET carries reportUrl and reportSha256.
          if (TERMINAL.includes(event.status)) void refresh();
        };
        patch(id, { mode: 'connecting' });
        void refresh().then(() => {
          if (stopped) return;
          if (!deps.openStream) return startPolling();
          stream = deps.openStream(eventsUrl(id));
          stream.onmessage = onEvent;
          stream.onerror = () => { if (!isTerminal(id)) startPolling(); };
        });
        return stop;
      },
    };
  });
}

export const useRequestStatus = createRequestStatusStore({
  api: defaultApi,
  openStream: typeof EventSource === 'undefined' ? null : (url) => new EventSource(url),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
});

export const selectRequestView = (id: string) => (state: RequestStatusState): RequestView => state.byId[id] ?? EMPTY;

export interface ReviewerProgress {
  reviewer: string;
  pass: number;
}

export function reviewerRows(events: ProgressEvent[]): ReviewerProgress[] {
  const passes = new Map<string, number>();
  for (const event of events) {
    const reviewer = event.progress?.reviewer;
    const pass = event.progress?.pass;
    if (reviewer && pass) passes.set(reviewer, Math.max(passes.get(reviewer) ?? 0, pass));
  }
  return [...passes].map(([reviewer, pass]) => ({ reviewer, pass }));
}

export function phasesSeen(events: ProgressEvent[]): string[] {
  const phases: string[] = [];
  for (const event of events) {
    const phase = event.progress?.phase;
    if (phase && phases[phases.length - 1] !== phase && !phases.includes(phase)) phases.push(phase);
  }
  return phases;
}
