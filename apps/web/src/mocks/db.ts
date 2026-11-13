// Dev/e2e only. In-memory intake state shared by the MSW handlers and the
// mock wallet, mirrored to sessionStorage so a reload or a deep link to /r/<id>
// keeps the same requests and local jobs. Never imported by a production build.
import type { PipelineMode } from '@/lib/api/schema.gen';

export const MOCK_ERRORS = [
  'QUEUE_FULL', 'REPO_PRIVATE', 'REPO_TOO_LARGE', 'REPO_NOT_FOUND', 'RATE_LIMITED',
  'REVIEW_FAILED', 'SSE_DROP',
] as const;
export type MockError = (typeof MOCK_ERRORS)[number];

export interface MockRequest {
  id: string;
  account: string;
  repo: string;
  commit: string;
  createdAt: number;
  /** When the worker picked the job up: the status walks queued -> running -> done from here. */
  startedAt: number;
  fails: boolean;
  pipelineMode?: PipelineMode;
  roundsCompleted?: number;
  parentId?: string | null;
}

export interface MockControls {
  error: MockError | null;
  walletReject: boolean;
  tampered: boolean;
}

export interface LocalJob {
  id: string;
  kind: 'path' | 'github';
  source: string;
  ref: string | null;
  commitSha: string | null;
  status: string;
  error: string | null;
  createdAt: number;
  pdfReady: boolean;
  pipelineMode?: PipelineMode;
  roundsCompleted?: number;
}

export interface MockState {
  nonces: Record<string, { expiresAt: number; used: boolean }>;
  requests: MockRequest[];
  session: string | null;
  /** The account's own provider keys (only whether one is set, its fingerprint and the chosen models). */
  ownKeys: Record<string, { set: boolean; fingerprint: string | null; models: string[] }>;
  localJobs: LocalJob[];
  controls: MockControls;
}

const KEY = 'omniswarm.mock.db';

export function emptyState(): MockState {
  return { nonces: {}, requests: [], session: null, ownKeys: {}, localJobs: [], controls: { error: null, walletReject: false, tampered: false } };
}

let memory: MockState | null = null;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readState(): MockState {
  if (memory) return memory;
  const raw = storage()?.getItem(KEY);
  if (!raw) {
    memory = emptyState();
    return memory;
  }
  // A payload saved before local jobs has no array. Fill it so a reload still works.
  const saved = JSON.parse(raw) as Partial<MockState>;
  memory = { ...emptyState(), ...saved, localJobs: saved.localJobs ?? [] };
  return memory;
}

export function updateState<T>(change: (state: MockState) => T): T {
  const state = readState();
  const result = change(state);
  storage()?.setItem(KEY, JSON.stringify(state));
  return result;
}

export function resetState(): void {
  memory = emptyState();
  storage()?.removeItem(KEY);
}

// A one-shot control fires once and clears itself (REVIEW_FAILED).
export function takeError(code: MockError): boolean {
  return updateState((state) => {
    if (state.controls.error !== code) return false;
    state.controls.error = null;
    return true;
  });
}

export const clock = { now: () => Date.now() };

// The schema's timestamp format: ISO 8601 UTC without milliseconds.
export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function randomBytes(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}
