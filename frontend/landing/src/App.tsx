import { useEffect, useReducer } from 'react';
import { HERO, initialState, payOffered, reduce, type Action, type Screen } from './flow.ts';
import { REPORT_FINDINGS, REPORT_GENERAL, TAMPED_FINDINGS, digestReport } from './report-doc.ts';
import { connectAccount, payQuote, signQuote } from './wallet.ts';

export function App({ initial, onAction }: { initial?: Screen; onAction?: (action: Action) => void } = {}) {
  const [state, dispatch] = useReducer(reduce, initial ?? initialState());
  const send = (action: Action) => {
    onAction?.(action);
    dispatch(action);
  };

  useEffect(() => {
    if (!state.paid || state.rejected) return undefined;
    const last = state.timeline[state.timeline.length - 1];
    if (last === 'done') {
      if (state.reportSha256) return undefined;
      let live = true;
      const findings = state.tampered ? TAMPED_FINDINGS : REPORT_FINDINGS;
      digestReport(findings, REPORT_GENERAL).then((hash) => {
        if (live) dispatch({ type: 'hashed', hash });
      });
      return () => { live = false; };
    }
    const timer = setTimeout(() => dispatch({ type: 'advance' }), 800);
    return () => clearTimeout(timer);
  }, [state.paid, state.rejected, state.timeline, state.reportSha256, state.tampered]);

  return (
    <div className="app">
      <header className="top">
        <a href="#home" onClick={(event) => { event.preventDefault(); send({ type: 'page', page: 'home' }); }}>OmniSwarm</a>
        <a href="#me" onClick={(event) => { event.preventDefault(); send({ type: 'page', page: 'me' }); }}>My requests</a>
        {state.account
          ? <span className="chip" data-testid="account">{state.account}<button type="button" onClick={() => send({ type: 'sign-out' })}>Sign out</button></span>
          : <button type="button" onClick={() => { void onConnect(send); }}>Connect NEAR wallet</button>}
      </header>
      {state.timeline.length ? <ol aria-label="Live timeline" aria-live="polite">{state.timeline.map((step) => <li key={step}>{step}</li>)}</ol> : null}
      {state.page === 'sample' ? <Sample /> : null}
      {state.page === 'me' ? <Me state={state} /> : null}
      {state.page === 'report' ? <Report state={state} send={send} /> : null}
      {state.page === 'home' ? <Home state={state} send={send} /> : null}
    </div>
  );
}

async function onConnect(send: (action: Action) => void) {
  const account = await connectAccount();
  send({ type: 'connected', account });
}

async function onSign(state: Screen, send: (action: Action) => void) {
  if (!state.account || !state.quote || state.quote.error) return;
  const signed = await signQuote({ account: state.account, repo: state.quote.repo, commit: state.quote.commitSha });
  send({ type: 'signed', signed });
}

async function onPay(state: Screen, send: (action: Action) => void) {
  try {
    await payQuote(Boolean(state.quote?.walletReject));
    send({ type: 'pay' });
  } catch (error) {
    if (error instanceof Error && error.name === 'UserRejected') send({ type: 'pay', reject: true });
    else throw error;
  }
}

function Home({ state, send }: { state: Screen; send: (action: Action) => void }) {
  return (
    <main>
      <h1>{HERO}</h1>
      <p><button type="button" onClick={() => send({ type: 'page', page: 'sample' })}>View a sample report</button></p>
      <form onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        send({ type: 'quote', repo: String(data.get('repo') || ''), mock: String(data.get('mock') || '') || undefined });
      }}>
        <label>GitHub repository<input name="repo" aria-label="GitHub repository" defaultValue="near/near-sdk-rs" /></label>
        <label>Mock<select name="mock" aria-label="Mock" defaultValue="">
          <option value="">none</option>
          <option value="REPO_PRIVATE">REPO_PRIVATE</option>
          <option value="QUEUE_FULL">QUEUE_FULL</option>
          <option value="WALLET_REJECT">WALLET_REJECT</option>
        </select></label>
        <button type="submit">Quote</button>
      </form>
      {state.quote?.error === 'private' ? <p role="alert">This repository is private</p> : null}
      {state.quote?.error === 'queue' ? <p role="alert">Queue is full, try later</p> : null}
      {state.quote && !state.quote.error ? <p>Quote {state.quote.repo} {state.quote.commitSha.slice(0, 7)} {state.quote.price}</p> : null}
      {state.quote && !state.quote.error && state.account ? <button type="button" onClick={() => { void onSign(state, send); }}>Sign request</button> : null}
      {state.signed && state.signature ? (
        <div data-testid="signed-request">
          <p>Request hash <span data-testid="request-hash">{state.requestHash}</span></p>
          <p>Signature <span data-testid="signature">{state.signature}</span></p>
          <p>Public key <span data-testid="public-key">{state.publicKey}</span></p>
          <p>Nonce <span data-testid="nonce">{state.nonce}</span></p>
          <p>Recipient <span data-testid="recipient">{state.recipient}</span></p>
          <pre data-testid="signed-message">{state.message}</pre>
        </div>
      ) : null}
      {payOffered(state) ? <button type="button" onClick={() => { void onPay(state, send); }}>Pay 1 NEAR</button> : null}
      {state.rejected ? <p role="alert">Payment cancelled in wallet <button type="button" onClick={() => send({ type: 'retry' })}>Retry</button></p> : null}
    </main>
  );
}

function Sample() {
  return <main><h1>Sample report</h1><p>Attested (sample)</p><p>No wallet is required.</p></main>;
}

function Me({ state }: { state: Screen }) {
  if (!state.account) return <main><p>Connect your wallet to see your requests</p></main>;
  return <main><h1>My requests</h1><ul>{state.requests.map((row) => <li key={row.id}>{row.repo} {row.status}</li>)}</ul></main>;
}

function Report({ state, send }: { state: Screen; send: (action: Action) => void }) {
  const findings = state.tampered ? TAMPED_FINDINGS : REPORT_FINDINGS;
  const matches = state.reportSha256 !== '' && state.reportSha256 === state.attestedSha256;
  return (
    <main>
      <h1>Report</h1>
      <p>{state.reportSha256 ? (matches ? 'hash matches on-chain attestation' : 'hash does not match the attestation') : 'Checking attestation'}</p>
      <p>Attestation <span data-testid="attested-hash">{state.attestedSha256}</span></p>
      <code data-testid="report-hash">{state.reportSha256}</code>
      <pre data-testid="report-findings">{JSON.stringify(findings)}</pre>
      <pre data-testid="report-general">{JSON.stringify(REPORT_GENERAL)}</pre>
      <button type="button" onClick={() => send({ type: 'tamper' })}>Tamper the report</button>
    </main>
  );
}
