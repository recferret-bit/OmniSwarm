// Dev/e2e only. In-memory intake + chain state shared by the MSW handlers and the
// mock wallet, mirrored to sessionStorage so a reload or a deep link to /r/<id>
// keeps the same requests and local jobs. Never imported by a production build.
import type { OnChainAttestation } from '@/lib/near/rpc';

export const MOCK_ERRORS = [
  'QUEUE_FULL', 'REPO_PRIVATE', 'REPO_TOO_LARGE', 'REPO_NOT_FOUND', 'RATE_LIMITED',
  'NONCE_EXPIRED', 'PAYMENT_NOT_FOUND', 'REVIEW_FAILED', 'SSE_DROP',
] as const;
export type MockError = (typeof MOCK_ERRORS)[number];

export interface MockRequest {
  id: string;
  account: string;
  repo: string;
  commit: string;
  deployed: string | null;
  requestHash: string;
  priceYocto: string;
  createdAt: number;
  paidAt: number | null;
  txHash: string | null;
  fails: boolean;
  attestTx: string | null;
  refundTx: string | null;
}

export interface MockTx {
  signer: string;
  receiver: string;
  requestHash: string;
  deposit: string;
}

// A guard report waiting for the owner's review (the admin listener is loopback-only and not mocked).
export interface MockGuardReport {
  id: string;
  account: string;
  reporter: string;
  evidenceUrl: string;
  reason: string;
  createdAt: number;
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
}

export interface MockState {
  nonces: Record<string, { expiresAt: number; used: boolean }>;
  requests: MockRequest[];
  txs: Record<string, MockTx>;
  attestations: Record<string, OnChainAttestation>;
  guardReports: MockGuardReport[];
  session: string | null;
  localJobs: LocalJob[];
  controls: MockControls;
}

const KEY = 'omniswarm.mock.db';

export function emptyState(): MockState {
  return { nonces: {}, requests: [], txs: {}, attestations: {}, guardReports: [], session: null, localJobs: [], controls: { error: null, walletReject: false, tampered: false } };
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

// A one-shot control fires once and clears itself (NONCE_EXPIRED, PAYMENT_NOT_FOUND).
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
