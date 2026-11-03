// GET /api/requests?mine=1 with the `sid` session cookie (W11-16).
import { create } from 'zustand';
import { api as defaultApi, type Api } from '@/lib/api/client';
import { toAppError, type AppErrorCode } from '@/lib/api/errors';
import type { RequestListResponse } from '@/lib/api/schema.gen';

export type MyRequest = RequestListResponse['requests'][number];

export interface MyRequestsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  requests: MyRequest[];
  error: AppErrorCode | null;
  load(): Promise<void>;
  clear(): void;
}

export function createMyRequestsStore(api: Api = defaultApi) {
  return create<MyRequestsState>()((set) => ({
    status: 'idle',
    requests: [],
    error: null,
    async load() {
      set({ status: 'loading', error: null });
      try {
        const { requests } = await api.listMine();
        set({ status: 'ready', requests });
      } catch (error) {
        set({ status: 'error', requests: [], error: toAppError(error).code });
      }
    },
    clear() {
      set({ status: 'idle', requests: [], error: null });
    },
  }));
}

export const useMyRequests = createMyRequestsStore();
