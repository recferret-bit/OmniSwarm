// The request-flow transitions. Each action reads the current step, calls the
// API or the wallet, and lands on the next step or on an error with its stage.
import { AppError, toAppError } from '@/lib/api/errors';
import type { QuoteResponse } from '@/lib/api/schema.gen';
import { env } from '@/lib/env';
import { normalizeWalletError } from '@/lib/near/connector';
import { buildSignedRequest } from '@/lib/near/nep413';
import { buildPaymentTx } from '@/lib/near/payment';
import { parseRepoInput, repoUrl } from '@/lib/repo';
import { confirmWithBackoff } from './confirm-payment';
import type { FlowData, FlowDeps, FlowStage, FlowState, FlowStep, SignedRequest } from './request-flow';

type Set = (partial: Partial<FlowState>) => void;
type Get = () => FlowState;

export const INITIAL_FLOW: FlowData = {
  step: 'idle', quote: null, deployed: null, signed: null, request: null, txHash: null, position: null, error: null,
};

// Challenge -> canonical message -> wallet signMessage -> POST /api/requests.
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
  const record: SignedRequest = { message: built.message, requestHash: built.requestHash, signature: signed.signature, publicKey: signed.publicKey, nonce: challenge.nonce };
  return { request, signed: record };
}

export function flowActions(deps: FlowDeps, set: Set, get: Get): Omit<FlowState, keyof FlowData> {
  const fail = (stage: FlowStage, error: unknown, step: FlowStep) => set({ step, error: { code: toAppError(error).code, stage } });

  return {
    async requestQuote(input, deployed) {
      const parsed = parseRepoInput(input);
      if (!parsed) return fail('quote', new AppError('REPO_INVALID'), 'idle');
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
          return set({ step: 'created', ...(await signAndCreate(deps, quote, accountId, deployed)) });
        } catch (error) {
          // An expired challenge restarts once with a fresh nonce (W11-12).
          if (attempt === 0 && toAppError(error).code === 'NONCE_EXPIRED') continue;
          return fail('sign', error, 'quoted');
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
        // Persisted before /payment, so a reload resumes with the same transaction.
        set({ step: 'confirming', txHash });
      } catch (error) {
        return fail('pay', error, 'created');
      }
      await get().confirm();
    },
    async confirm() {
      const { request, txHash } = get();
      if (!request || !txHash) return;
      set({ step: 'confirming', error: null });
      try {
        set({ step: 'queued', position: await confirmWithBackoff(deps, request.requestId, txHash) });
      } catch (error) {
        fail('confirm', error, 'failed');
      }
    },
    reset() {
      set(INITIAL_FLOW);
    },
  };
}
