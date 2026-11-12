// Quote -> sign -> create -> pay -> confirm (INTAKE section 3, steps 2-7).
// Persisted to sessionStorage (requestId, requestHash, txHash, step) so a reload
// during "Confirming" resumes confirming the same transaction.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api as defaultApi, type Api } from '@/lib/api/client';
import type { AppErrorCode } from '@/lib/api/errors';
import type { CreateRequestResponse, QuoteResponse } from '@/lib/api/schema.gen';
import { getConnector, type WalletConnector } from '@/lib/near/connector';
import { flowActions, INITIAL_FLOW } from './request-flow-actions';

export { INITIAL_FLOW };

export type FlowStep = 'idle' | 'quoting' | 'quoted' | 'signing' | 'created' | 'paying' | 'confirming' | 'queued' | 'failed';
export type FlowStage = 'quote' | 'sign' | 'pay' | 'confirm';

export interface SignedRequest {
  message: string;
  requestHash: string;
  signature: string;
  publicKey: string;
  nonce: string;
}

export interface FlowData {
  step: FlowStep;
  quote: QuoteResponse | null;
  deployed: string | null;
  signed: SignedRequest | null;
  request: CreateRequestResponse | null;
  txHash: string | null;
  position: number | null;
  error: { code: AppErrorCode; stage: FlowStage } | null;
}

export interface FlowState extends FlowData {
  requestQuote(input: string, deployed?: string): Promise<void>;
  /** `preset` overrides the quote's hosted preset, for example `account-nearai` (the account's own provider key). */
  sign(accountId: string, preset?: string): Promise<void>;
  pay(): Promise<void>;
  confirm(): Promise<void>;
  reset(): void;
}

export interface FlowDeps {
  api: Api;
  connector: () => Promise<WalletConnector>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  storage: () => Storage;
}

// After a reload an in-flight step cannot continue: the wallet popup or the
// quote request is gone. Fall back to the last step the data still supports.
// (A reload while paying cannot know whether the transaction left; the contract
// rejects a reused request hash, so offering Pay again is safe.)
export function resumeStep(saved: Partial<FlowData>): FlowStep {
  if (saved.step === 'paying') return saved.request ? 'created' : 'idle';
  if (saved.step === 'signing') return saved.quote ? 'quoted' : 'idle';
  if (saved.step === 'quoting') return 'idle';
  return saved.step ?? 'idle';
}

export function createRequestFlowStore(deps: FlowDeps) {
  return create<FlowState>()(persist((set, get) => ({ ...INITIAL_FLOW, ...flowActions(deps, set, get) }), {
    name: 'omniswarm.request-flow',
    version: 1,
    storage: createJSONStorage(deps.storage),
    skipHydration: true,
    partialize: ({ step, quote, deployed, signed, request, txHash, position }) => ({ step, quote, deployed, signed, request, txHash, position }),
    merge: (persisted, current) => {
      const saved = (persisted ?? {}) as Partial<FlowData>;
      return { ...current, ...saved, step: resumeStep(saved), error: null };
    },
  }));
}

export const useRequestFlow = createRequestFlowStore({
  api: defaultApi,
  connector: getConnector,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  storage: () => sessionStorage,
});

export const selectCanSign = (state: FlowState) => state.step === 'quoted' && state.quote !== null;
export const selectCanPay = (state: FlowState) => state.step === 'created' && state.request !== null;
export const selectBusy = (state: FlowState) => ['quoting', 'signing', 'paying', 'confirming'].includes(state.step);
