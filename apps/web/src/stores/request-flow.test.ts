import { describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { createMockConnector } from '@/mocks/wallet';
import { setMockError, setWalletReject } from '@/mocks/controls';
import { readState } from '@/mocks/db';
import { useMockApi } from '@/test/msw';
import { verifySignature } from '@/mocks/verify';
import { createRequestFlowStore, resumeStep, type FlowDeps } from './request-flow';

useMockApi();

function flowStore(overrides: Partial<FlowDeps> = {}) {
  const connector = createMockConnector();
  return createRequestFlowStore({
    api, connector: async () => connector, sleep: async () => undefined, now: () => Date.now(), storage: () => sessionStorage, ...overrides,
  });
}

async function signedStore(overrides: Partial<FlowDeps> = {}) {
  const store = flowStore(overrides);
  await store.getState().requestQuote('https://github.com/near-examples/guest-book-examples');
  await store.getState().sign('alice.testnet');
  return store;
}

describe('request flow store', () => {
  it('signs the quoted hosted preset by default and an account- preset when one is chosen', async () => {
    const store = flowStore();
    await store.getState().requestQuote('https://github.com/near-examples/guest-book-examples');
    const create = vi.spyOn(api, 'createRequest');
    await store.getState().sign('alice.testnet', 'account-nearai');
    const sent = create.mock.calls[0]![0] as { message: string };
    expect(JSON.parse(sent.message)).toMatchObject({ preset: 'account-nearai' });
    const plain = await signedStore();
    expect(JSON.parse(plain.getState().signed!.message)).toMatchObject({ preset: 'scripted' });
  });

  it('quotes, signs the challenge nonce, creates, pays and confirms to queued', async () => {
    const challenge = vi.spyOn(api, 'challenge');
    const store = await signedStore();
    const { signed, request } = store.getState();
    expect(store.getState().step).toBe('created');
    const issued = (await challenge.mock.results[0]!.value) as { nonce: string };
    expect(signed!.nonce).toBe(issued.nonce);
    expect(JSON.parse(signed!.message)).toMatchObject({ nonce: issued.nonce, repo: 'near-examples/guest-book-examples', v: 1 });
    expect(request!.requestHash).toBe(signed!.requestHash);
    expect(await verifySignature({ ...signed!, recipient: 'omniswarm.testnet' })).toBe(true);
    await store.getState().pay();
    expect(store.getState()).toMatchObject({ step: 'queued', position: 1, error: null });
    expect(readState().requests[0]!.txHash).toBe(store.getState().txHash);
  });

  it('shows REPO_INVALID without calling the API and QUEUE_FULL without a quote', async () => {
    const quote = vi.spyOn(api, 'quote');
    const store = flowStore();
    await store.getState().requestQuote('foo bar');
    expect(store.getState().error).toEqual({ code: 'REPO_INVALID', stage: 'quote' });
    expect(quote).not.toHaveBeenCalled();
    setMockError('QUEUE_FULL');
    await store.getState().requestQuote('near/near-sdk-rs');
    expect(store.getState()).toMatchObject({ step: 'idle', quote: null, error: { code: 'QUEUE_FULL', stage: 'quote' } });
  });

  it('restarts an expired challenge once', async () => {
    setMockError('NONCE_EXPIRED');
    const challenge = vi.spyOn(api, 'challenge');
    const store = await signedStore();
    expect(store.getState().step).toBe('created');
    expect(challenge).toHaveBeenCalledTimes(2);
  });

  it('a wallet rejection offers Retry and the retry pays', async () => {
    const store = await signedStore();
    setWalletReject(true);
    await store.getState().pay();
    expect(store.getState()).toMatchObject({ step: 'created', txHash: null, error: { code: 'WALLET_REJECTED', stage: 'pay' } });
    await store.getState().pay();
    expect(store.getState().step).toBe('queued');
  });

  it('retries PAYMENT_NOT_FOUND with backoff until the payment is visible', async () => {
    const sleep = vi.fn(async () => undefined);
    const store = await signedStore({ sleep });
    setMockError('PAYMENT_NOT_FOUND');
    await store.getState().pay();
    expect(store.getState().step).toBe('queued');
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('refuses to pay a contract other than NEXT_PUBLIC_CONTRACT_ID', async () => {
    const store = await signedStore();
    store.setState({ request: { ...store.getState().request!, contractId: 'attacker.testnet' } });
    await store.getState().pay();
    expect(store.getState()).toMatchObject({ step: 'created', txHash: null, error: { code: 'CONTRACT_MISMATCH', stage: 'pay' } });
    expect(Object.keys(readState().txs)).toHaveLength(0);
  });

  it('persists the request and tx hash so a reload resumes confirming the same transaction', async () => {
    const store = await signedStore();
    store.setState({ step: 'confirming', txHash: 'unconfirmed' });
    const saved = JSON.parse(sessionStorage.getItem('omniswarm.request-flow')!) as { state: Record<string, unknown> };
    expect(saved.state).toMatchObject({ step: 'confirming', txHash: 'unconfirmed', request: store.getState().request });
    expect(saved.state).not.toHaveProperty('error');

    const confirmPayment = vi.spyOn(api, 'confirmPayment');
    const reloaded = flowStore({ sleep: async () => undefined, now: (() => { let t = 0; return () => (t += 30_000); })() });
    await reloaded.persist.rehydrate();
    expect(reloaded.getState()).toMatchObject({ step: 'confirming', txHash: 'unconfirmed' });
    await reloaded.getState().confirm();
    expect(confirmPayment).toHaveBeenCalledWith(store.getState().request!.requestId, { txHash: 'unconfirmed' });
    expect(reloaded.getState().error).toEqual({ code: 'PAYMENT_NOT_FOUND', stage: 'confirm' });
  });

  it('a reload mid-step falls back to the last step its data supports', () => {
    const request = { requestId: 'r', requestHash: 'h', priceYocto: '1', contractId: 'c' };
    expect(resumeStep({ step: 'paying', request })).toBe('created');
    expect(resumeStep({ step: 'signing', quote: {} as never })).toBe('quoted');
    expect(resumeStep({ step: 'quoting' })).toBe('idle');
    expect(resumeStep({ step: 'confirming' })).toBe('confirming');
  });
});
