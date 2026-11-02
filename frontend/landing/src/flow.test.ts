import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { HERO, initialState, payOffered, reduce, SAMPLE_SHA } from './flow.ts';

describe('landing flow', () => {
  it('shows the hero and a sample report with no wallet', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain(HERO);
    const sample = renderToStaticMarkup(createElement(App, { initial: { ...initialState(), page: 'sample' } }));
    expect(sample).toContain('Attested (sample)');
    expect(sample).toContain('No wallet is required.');
  });

  it('connects, quotes, signs, pays, and lists the request', () => {
    let state = reduce(initialState(), { type: 'connect' });
    expect(state.account).toBe('alice.testnet');
    state = reduce(state, { type: 'quote', repo: 'https://github.com/near/near-sdk-rs' });
    expect(state.quote?.price).toBe('1 NEAR');
    state = reduce(state, { type: 'sign' });
    expect(state.requestHash).toBe(SAMPLE_SHA);
    expect(payOffered(state)).toBe(true);
    state = reduce(state, { type: 'pay' });
    expect(state.timeline).toEqual(['queued', 'running', 'done']);
    expect(state.reportSha256).toBe(state.attestedSha256);
    const me = renderToStaticMarkup(createElement(App, { initial: { ...state, page: 'me' } }));
    expect(me).toContain('near/near-sdk-rs');
    expect(me).toContain('done');
    const report = renderToStaticMarkup(createElement(App, { initial: state }));
    expect(report).toContain('hash matches on-chain attestation');
  });

  it('blocks pay for a private repo and a full queue, and shows a wallet rejection', () => {
    const priv = reduce(initialState(), { type: 'quote', repo: 'private/hidden' });
    expect(renderToStaticMarkup(createElement(App, { initial: priv }))).toContain('This repository is private');
    expect(payOffered(priv)).toBe(false);
    const full = reduce(reduce(initialState(), { type: 'connect' }), { type: 'quote', repo: 'near/near-sdk-rs', mock: 'QUEUE_FULL' });
    expect(renderToStaticMarkup(createElement(App, { initial: full }))).toContain('Queue is full, try later');
    expect(payOffered(reduce(full, { type: 'sign' }))).toBe(false);
    const signed = reduce(reduce(reduce(initialState(), { type: 'connect' }), { type: 'quote', repo: 'near/near-sdk-rs' }), { type: 'sign' });
    const rejected = reduce(signed, { type: 'pay', reject: true });
    expect(renderToStaticMarkup(createElement(App, { initial: rejected }))).toContain('Payment cancelled in wallet');
    expect(renderToStaticMarkup(createElement(App, { initial: rejected }))).toContain('Retry');
  });
});
