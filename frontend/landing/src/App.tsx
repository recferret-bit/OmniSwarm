import { useReducer } from 'react';
import { HERO, initialState, payOffered, reduce, type Action, type Screen } from './flow.ts';

export function App({ initial, onAction }: { initial?: Screen; onAction?: (action: Action) => void } = {}) {
  const [state, dispatch] = useReducer(reduce, initial ?? initialState());
  const send = (action: Action) => {
    onAction?.(action);
    dispatch(action);
  };
  return (
    <div className="app">
      <header className="top">
        <a href="#home" onClick={(event) => { event.preventDefault(); send({ type: 'page', page: 'home' }); }}>OmniSwarm</a>
        {state.account ? <span className="chip">{state.account}<button type="button" onClick={() => send({ type: 'sign-out' })}>Sign out</button></span> : <button type="button" onClick={() => send({ type: 'connect' })}>Connect NEAR wallet</button>}
      </header>
      {state.page === 'sample' ? <Sample /> : null}
      {state.page === 'me' ? <Me state={state} /> : null}
      {state.page === 'report' ? <Report state={state} /> : null}
      {state.page === 'home' ? <Home state={state} send={send} /> : null}
    </div>
  );
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
        <label>Mock<select name="mock" aria-label="Mock" defaultValue=""><option value="">none</option><option value="REPO_PRIVATE">REPO_PRIVATE</option><option value="QUEUE_FULL">QUEUE_FULL</option></select></label>
        <button type="submit">Quote</button>
      </form>
      {state.quote?.error === 'private' ? <p role="alert">This repository is private</p> : null}
      {state.quote?.error === 'queue' ? <p role="alert">Queue is full, try later</p> : null}
      {state.quote && !state.quote.error ? <p>Quote {state.quote.repo} {state.quote.commitSha.slice(0, 7)} {state.quote.price}</p> : null}
      {state.quote && !state.quote.error ? <button type="button" onClick={() => send({ type: 'sign' })}>Sign request</button> : null}
      {state.signed ? <p>Request hash {state.requestHash}</p> : null}
      {payOffered(state) ? <button type="button" onClick={() => send({ type: 'pay' })}>Pay 1 NEAR</button> : null}
      {state.rejected ? <p role="alert">Payment cancelled in wallet <button type="button" onClick={() => send({ type: 'retry' })}>Retry</button></p> : null}
      {state.timeline.length ? <ol aria-label="Live timeline">{state.timeline.map((step) => <li key={step}>{step}</li>)}</ol> : null}
      <p><a href="#me" onClick={(event) => { event.preventDefault(); send({ type: 'page', page: 'me' }); }}>My requests</a></p>
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

function Report({ state }: { state: Screen }) {
  const matches = state.reportSha256 === state.attestedSha256;
  return <main><h1>Report</h1><p>{matches ? 'hash matches on-chain attestation' : 'hash does not match the attestation'}</p><code>{state.reportSha256}</code></main>;
}
