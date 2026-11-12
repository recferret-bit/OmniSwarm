'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api, requestReportHref, type AccountKeyView } from '@/lib/api/client';
import { messageFor, toAppError, type AppErrorCode } from '@/lib/api/errors';
import type { PipelineMode } from '@/lib/api/schema.gen';
import { parseRepoInput } from '@/lib/repo';
import { type MyRequest } from '@/stores/my-requests';
import { statusLabel } from '../request/Timeline';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { Pill } from '../ui/Pill';
import { PipelineModeChecks, parseSavedPipelineMode } from '../flow/PipelineModeChecks';
import { ScopeChecks } from '../flow/ScopeChecks';
import { phaseLabel } from '../request/ProgressPanel';
import { AccountKeyPanel, keyReady } from '../account/AccountKeyPanel';

type Pending = 'login' | 'logout' | 'submit' | null;

function Row({ row }: { row: MyRequest }) {
  const tone = row.status === 'done' ? 'good' : row.status === 'failed' || row.status === 'refunded' ? 'bad' : 'info';
  return (
    <li className="request-row">
      <Link href={`/r/${row.requestId}`} className="request-row__repo">{row.theme ? `${row.repo} · ${row.theme}` : row.repo}</Link>
      <Pill tone={tone}>{statusLabel(row.status)}</Pill>
      {row.status === 'running' && row.progress ? <span className="muted">{phaseLabel(row.progress.phase)} · {Math.round(row.progress.percent ?? 0)}%</span> : null}
      <time className="muted" dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
      {row.status === 'done' ? <a href={requestReportHref(row.requestId)}>Download PDF</a> : null}
    </li>
  );
}

export function Dashboard() {
  const [phase, setPhase] = useState<'loading' | 'anonymous' | 'ready'>('loading');
  const [account, setAccount] = useState<string | null>(null);
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [error, setError] = useState<AppErrorCode | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [repo, setRepo] = useState('');
  const [repoError, setRepoError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>(['full']);
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('full');
  // Providers that take the account's own key (provider catalog; today NEAR AI Cloud). `panel` is the operator's panel.
  const [own, setOwn] = useState<AccountKeyView[]>([]);
  const [source, setSource] = useState<string>('panel');
  const chosen = own.find((view) => view.provider === source);
  const replace = (next: AccountKeyView) => setOwn((current) => current.map((view) => (view.provider === next.provider ? next : view)));
  const extras = [
    ['opus', 'Opus 5.5'],
    ['sol', 'Sol 6.1'],
    ['argon', 'Argon 4'],
    ['grok', 'Grok 4.7'],
  ] as const;

  const loadOwn = async () => {
    try {
      const { providers } = await api.listAccountKeys();
      setOwn(providers);
      // An account's own key is the main source: the first ready one becomes the default.
      const ready = providers.find(keyReady);
      if (ready) setSource(ready.provider);
    } catch { /* the panels stay hidden; submitting the panel review still works */ }
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const session = await api.session();
        if (!live) return;
        setAccount(session.account);
        setPhase('ready');
        void loadOwn();
        try {
          const listed = await api.listMine();
          if (live) setRequests(listed.requests);
        } catch (caught) {
          if (live) setError(toAppError(caught).code);
        }
      } catch (caught) {
        if (!live) return;
        const code = toAppError(caught).code;
        if (code !== 'UNAUTHORIZED') setError(code);
        setPhase('anonymous');
      }
    })();
    try {
      const savedRepo = sessionStorage.getItem('omniswarm-repo');
      const savedScope = sessionStorage.getItem('omniswarm-scope');
      const savedPipeline = sessionStorage.getItem('omniswarm-pipeline-mode');
      if (savedRepo) setRepo(savedRepo);
      if (savedPipeline) setPipelineMode(parseSavedPipelineMode(savedPipeline));
      if (savedScope) {
        const parsed = JSON.parse(savedScope) as unknown;
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) setScopes(parsed);
      }
    } catch { /* the quote form is the only writer */ }
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const timer = window.setInterval(() => {
      void api.listMine().then((listed) => setRequests(listed.requests)).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending('login');
    setError(null);
    try {
      const session = await api.login({ login, password });
      setAccount(session.account);
      setPhase('ready');
      void loadOwn();
      setLogin('');
      setPassword('');
      const listed = await api.listMine();
      setRequests(listed.requests);
    } catch (caught) {
      setError(toAppError(caught).code);
    } finally {
      setPending(null);
    }
  };

  const signOut = async () => {
    if (pending) return;
    setPending('logout');
    setError(null);
    try {
      await api.logout();
      setAccount(null);
      setRequests([]);
      setRepo('');
      setRepoError(null);
      setOwn([]);
      setSource('panel');
      setPhase('anonymous');
    } catch (caught) {
      setError(toAppError(caught).code);
    } finally {
      setPending(null);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (scopes.length === 0) return;
    if (!parseRepoInput(repo)) {
      setRepoError(messageFor('REPO_INVALID'));
      return;
    }
    setPending('submit');
    setError(null);
    setDetail(null);
    setRepoError(null);
    try {
      const modeOpt = pipelineMode !== 'full' ? { pipelineMode } : {};
      await api.createDashboardJob(
        source !== 'panel'
          ? { repo: repo.trim(), scopes, source, ...modeOpt }
          : { repo: repo.trim(), models, scopes, ...modeOpt },
      );
      setRepo('');
      const listed = await api.listMine();
      setRequests(listed.requests);
    } catch (caught) {
      const appError = toAppError(caught);
      if (appError.code === 'REPO_INVALID') setRepoError(messageFor(appError.code));
      else { setError(appError.code); setDetail(appError.message); }
    } finally {
      setPending(null);
    }
  };

  if (phase === 'loading') return <p role="status">Loading…</p>;

  if (phase === 'anonymous' || !account) {
    return (
      <Panel title="Sign in">
        <form className="quote-form" onSubmit={(event) => void signIn(event)} noValidate>
          <Field
            label="Login"
            name="login"
            autoComplete="username"
            autoFocus
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            required
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error ? <Alert>{messageFor(error)}</Alert> : null}
          <Button type="submit" busy={pending === 'login'}>Sign in</Button>
        </form>
        <p className="muted">Development sign-in is <code>operator</code> / <code>operator</code>. NEAR sign-in replaces this later.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Request a review">
      <div className="request-row">
        <span>Signed in as <strong>{account}</strong></span>
        <Button variant="secondary" onClick={() => void signOut()} busy={pending === 'logout'}>Log out</Button>
      </div>
      <form className="quote-form" onSubmit={(event) => void submit(event)} noValidate>
        <Field
          label="GitHub repository"
          name="repo"
          placeholder="owner/name or https://github.com/owner/name"
          autoComplete="off"
          spellCheck={false}
          value={repo}
          onChange={(event) => { setRepo(event.target.value); setRepoError(null); }}
          error={repoError}
          required
        />
        <ScopeChecks selected={scopes} onChange={setScopes} />
        <PipelineModeChecks name="dashboard-pipeline-mode" value={pipelineMode} onChange={setPipelineMode} />
        <fieldset className="quote-form">
          <legend>Review with</legend>
          {own.map((view) => (
            <label key={view.provider}>
              <input type="radio" name="source" value={view.provider} checked={source === view.provider} onChange={() => setSource(view.provider)} />
              {' '}{view.label} (your key){keyReady(view) ? ` · ${view.models.length} model${view.models.length === 1 ? '' : 's'}` : ' · save a key and a model below'}
            </label>
          ))}
          <label>
            <input type="radio" name="source" value="panel" checked={source === 'panel'} onChange={() => setSource('panel')} />
            {' '}Hosted panel (Z.AI and OpenRouter)
          </label>
        </fieldset>
        <fieldset className="quote-form" hidden={source !== 'panel'} disabled={source !== 'panel'}>
          <legend>Models</legend>
          <p className="muted">GLM 5.3 on Z.AI orchestrates. Qwen on OpenRouter reviews with it. Add any of these.</p>
          {extras.map(([id, label]) => (
            <label key={id}>
              <input
                type="checkbox"
                name="models"
                value={id}
                checked={models.includes(id)}
                onChange={(event) => setModels((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))}
              />
              {' '}{label}
            </label>
          ))}
        </fieldset>
        <Button type="submit" busy={pending === 'submit'} disabled={pending !== null || scopes.length === 0 || (source !== 'panel' && !keyReady(chosen))}>Submit</Button>
      </form>
      {own.map((view) => <AccountKeyPanel key={view.provider} view={view} onChange={replace} />)}
      {detail ? <Alert>{detail}</Alert> : error ? <Alert>{messageFor(error)}</Alert> : null}
      {requests.length === 0 ? <p>No reviews yet.</p> : (
        <ul className="request-list" aria-label="Your reviews">{requests.map((row) => <Row key={row.requestId} row={row} />)}</ul>
      )}
    </Panel>
  );
}
