import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { HERO, initialState, nextTimeline, payOffered, reduce } from './flow.ts';
import { ATTESTED_SHA256, REPORT_FINDINGS, REPORT_GENERAL, TAMPED_FINDINGS, digestReport } from './report-doc.ts';
import { connectAccount, signQuote } from './wallet.ts';
import { requestHash } from '@omniswarm/schemas/canonical-message';

describe('landing flow', () => {
  it('shows the hero and a sample report with no wallet', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain(HERO);
    const sample = renderToStaticMarkup(createElement(App, { initial: { ...initialState(), page: 'sample' } }));
    expect(sample).toContain('Attested (sample)');
    expect(sample).toContain('No wallet is required.');
  });

  it('connects through the wallet, signs NEP-413, and advances the timeline one phase at a time', async () => {
    const account = await connectAccount();
    expect(account).toBe('alice.testnet');
    let state = reduce(initialState(), { type: 'connected', account });
    expect(state.account).toBe(account);
    state = reduce(state, { type: 'quote', repo: 'https://github.com/near/near-sdk-rs' });
    expect(state.quote?.price).toBe('1 NEAR');
    const signed = await signQuote({ account, repo: state.quote!.repo, commit: state.quote!.commitSha });
    expect(signed.signature.length).toBeGreaterThan(40);
    expect(signed.publicKey.startsWith('ed25519:')).toBe(true);
    expect(signed.requestHash).toBe(await requestHash(signed.message));
    expect(signed.requestHash).not.toBe('ab'.repeat(32));
    state = reduce(state, { type: 'signed', signed });
    expect(state.signature).toBe(signed.signature);
    expect(payOffered(state)).toBe(true);
    state = reduce(state, { type: 'pay' });
    expect(state.timeline).toEqual(['queued']);
    state = reduce(state, { type: 'advance' });
    expect(state.timeline).toEqual(['queued', 'running']);
    expect(nextTimeline(state.timeline)).toEqual(['queued', 'running', 'done']);
    state = reduce(state, { type: 'advance' });
    expect(state.timeline).toEqual(['queued', 'running', 'done']);
    const hash = await digestReport(REPORT_FINDINGS, REPORT_GENERAL);
    expect(hash).toBe(ATTESTED_SHA256);
    expect(hash).toBe(state.attestedSha256);
    state = reduce(state, { type: 'hashed', hash });
    const me = renderToStaticMarkup(createElement(App, { initial: { ...state, page: 'me' } }));
    expect(me).toContain('near/near-sdk-rs');
    expect(me).toContain('done');
    const report = renderToStaticMarkup(createElement(App, { initial: state }));
    expect(report).toContain('hash matches on-chain attestation');
    expect(report).toContain(hash);
    const tampered = await digestReport(TAMPED_FINDINGS, REPORT_GENERAL);
    expect(tampered).not.toBe(ATTESTED_SHA256);
    const bad = reduce(state, { type: 'hashed', hash: tampered });
    expect(renderToStaticMarkup(createElement(App, { initial: { ...bad, tampered: true } }))).toContain('hash does not match the attestation');
  });

  it('blocks pay for a private repo and a full queue, and shows a wallet rejection', () => {
    const priv = reduce(initialState(), { type: 'quote', repo: 'private/hidden' });
    expect(renderToStaticMarkup(createElement(App, { initial: priv }))).toContain('This repository is private');
    expect(payOffered(priv)).toBe(false);
    const full = reduce(reduce(initialState(), { type: 'connected', account: 'alice.testnet' }), { type: 'quote', repo: 'near/near-sdk-rs', mock: 'QUEUE_FULL' });
    expect(renderToStaticMarkup(createElement(App, { initial: full }))).toContain('Queue is full, try later');
    expect(payOffered(full)).toBe(false);
    const quoted = reduce(reduce(initialState(), { type: 'connected', account: 'alice.testnet' }), { type: 'quote', repo: 'near/near-sdk-rs' });
    const signed = reduce(quoted, {
      type: 'signed',
      signed: {
        requestHash: '11'.repeat(32),
        signature: '4' + 'a'.repeat(80),
        publicKey: 'ed25519:test',
        message: '{}',
        nonce: 'aa',
        recipient: 'omniswarm.testnet',
      },
    });
    const rejected = reduce(signed, { type: 'pay', reject: true });
    const html = renderToStaticMarkup(createElement(App, { initial: rejected }));
    expect(html).toContain('Payment cancelled in wallet');
    expect(html).toContain('Retry');
    expect(payOffered(rejected)).toBe(true);
  });
});
