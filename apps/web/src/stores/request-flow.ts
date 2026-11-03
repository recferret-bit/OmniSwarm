// Quote -> sign -> create -> pay -> confirm (INTAKE section 3, steps 2-7).
// Persisted to sessionStorage (requestId, requestHash, txHash, step) so a reload
// during "Confirming" resumes confirming the same transaction.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api as defaultApi, type Api } from '@/lib/api/client';
import { AppError, toAppError, type AppErrorCode } from '@/lib/api/errors';
import type { CreateRequestResponse, QuoteResponse } from '@/lib/api/schema.gen';
import { env } from '@/lib/env';
import { getConnector, normalizeWalletError, type WalletConnector } from '@/lib/near/connector';
import { buildSignedRequest } from '@/lib/near/nep413';
import { buildPaymentTx } from '@/lib/near/payment';
import { parseRepoInput, repoUrl } from '@/lib/repo';
import { confirmWithBackoff } from './confirm-payment';

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
  sign(accountId: string): Promise<void>;
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

export const INITIAL_FLOW: FlowData = {
  step: 'idle', quote: null, deployed: null, signed: null, request: null, txHash: null, position: null, error: null,
};

async function signAndCreate(deps: FlowDeps, quote: QuoteResponse, accountId: string, deployed: string | null) {
  const challenge = await deps.api.challenge();
  const built = await buildSignedRequest({
    account: accountId, commit: quote.commitSha, deployed, network: env.network,
    nonce: challenge.nonce, preset: quote.preset, repo: quote.normalizedRepo,
  });
  const wallet = await deps.connector();
  const signed = await wallet.signMessage({ message: built.message, recipient: env.intakeRecipient, nonce: built.nonceBytes })
    .catch((error: unknown) => { throw normalizeWalletError(error); });
  if (signed.accountId && signed.accountId !== accountId) throw new AppError('ACCOUNT_MISMATCH');
  const request = await deps.api.createRequest({
    accountId, publicKey: signed.publicKey, signature: signed.signature, message: built.message, nonce: challenge.nonce,
  });
  if (request.requestHash !== built.requestHash) throw new AppError('MESSAGE_INVALID', 'The API returned a different request hash');
  const record: SignedRequest = { ...built, signature: signed.signature, publicKey: signed.publicKey, nonce: challenge.nonce };
  return { request, signed: record };
}

export function createRequestFlowStore(deps: FlowDeps) {
  return create<FlowState>()(persist((set, get) => {
    const fail = (stage: FlowStage, error: unknown, step: FlowStep) => set({ step, error: { code: toAppError(error).code, stage } });
    return {
      ...INITIAL_FLOW,
      async requestQuote(input, deployed) {
        const parsed = parseRepoInput(input);
        if (!parsed) {
          fail('quote', new AppError('REPO_INVALID'), 'idle');
          return;
        }
        set({ ...INITIAL_FLOW, step: 'quoting', deployed: deployed?.trim() || null });
        try {
          const quote = await deps.api.quote({ repoUrl: repoUrl(parsed.repo), network: env.network, ...(parsed.ref ? { ref: parsed.ref } : {}) });
          set({ step: 'quoted', quote });
        } catch (error) {
          fail('quote', error, 'idle');
        }
      },
      async sign(accountId) {
        const { quote, deployed } = get();
        if (!quote) return;
        set({ step: 'signing', error: null });
        for (let attempt = 0; ; attempt += 1) {
          try {
            const { request, signed } = await signAndCreate(deps, quote, accountId, deployed);
            set({ step: 'created', request, signed });
            return;
          } catch (error) {
            // An expired challenge restarts once with a fresh nonce (W11-12).
            if (attempt === 0 && toAppError(error).code === 'NONCE_EXPIRED') continue;
            fail('sign', error, 'quoted');
            return;
          }
        }
      },
      async pay() {
        const { request } = get();
        if (!request) return;
        set({ step: 'paying', error: null });
        try {
          const tx = buildPaymentTx(request);
          const wallet = await deps.connector();
          const { txHash } = await wallet.signAndSendTransaction(tx).catch((error: unknown) => { throw normalizeWalletError(error); });
          set({ step: 'confirming', txHash });
        } catch (error) {
          fail('pay', error, 'created');
          return;
        }
        await get().confirm();
      },
      async confirm() {
        const { request, txHash } = get();
        if (!request || !txHash) return;
        set({ step: 'confirming', error: null });
        try {
          const position = await confirmWithBackoff(deps, request.requestId, txHash);
          set({ step: 'queued', position });
        } catch (error) {
          fail('confirm', error, 'failed');
        }
      },
      reset() {
        set(INITIAL_FLOW);
      },
    };
  }, {
    name: 'omniswarm.request-flow',
    version: 1,
    storage: createJSONStorage(deps.storage),
    skipHydration: true,
    partialize: ({ step, quote, deployed, signed, request, txHash, position }) => ({ step, quote, deployed, signed, request, txHash, position }),
    // A reload while the wallet popup was open cannot know whether a transaction
    // left; the contract rejects a reused request hash, so offering Pay again is safe.
    merge: (persisted, current) => {
      const saved = (persisted ?? {}) as Partial<FlowData>;
      const step = saved.step === 'paying' || saved.step === 'signing' || saved.step === 'quoting' ? (saved.request ? 'created' : 'idle') : saved.step;
      return { ...current, ...saved, step: step ?? 'idle', error: null };
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
