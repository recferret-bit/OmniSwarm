'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api, requestReportHref, type AccountKeyView, type SessionAccount } from '@/lib/api/client';
import { messageFor, toAppError, type AppErrorCode } from '@/lib/api/errors';
import type { PipelineMode } from '@/lib/api/schema.gen';
import { parseRepoInput } from '@/lib/repo';
import { type MyRequest } from '@/stores/my-requests';
import { SignInPanel } from '../auth/SignIn';
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
import { ReportTabs } from '../report/ReportTabs';
import { Donate } from '../support/Donate';

type Pending = 'logout' | 'submit' | null;
type DashTab = 'settings' | 'review' | 'history';

// The only way to review in the cloud: the signed-in account's own NEAR AI Cloud key (provider catalog `nearai`).
const OWN_PROVIDER = 'nearai';
export const OWN_KEY_PROMPT = 'Paste your NEAR AI Cloud API key to run reviews. You pay NEAR AI directly; OmniSwarm charges nothing.';

function displayName(session: SessionAccount): string {
  return session.label || session.account;
}

function Row({ row }: { row: MyRequest }) {
  const tone = row.status === 'done' ? 'good' : row.status === 'failed' || row.status === 'refunded' ? 'bad' : 'info';
  return (
    <li className="request-row">
      <Link href={`/dashboard/requests/${row.requestId}`} className="request-row__repo">{row.theme ? `${row.repo} · ${row.theme}` : row.repo}</Link>
      <Pill tone={tone}>{statusLabel(row.status)}</Pill>
      {row.status === 'running' && row.progress ? <span className="muted">{phaseLabel(row.progress.phase)} · {Math.round(row.progress.percent ?? 0)}%</span> : null}
      <time className="muted" dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
      {row.status === 'done' ? <a href={requestReportHref(row.requestId)}>Download PDF</a> : null}
    </li>
  );
}

export function Dashboard() {
  const [phase, setPhase] = useState<'loading' | 'anonymous' | 'ready'>('loading');
  const [name, setName] = useState<string | null>(null);
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [error, setError] = useState<AppErrorCode | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [repo, setRepo] = useState('');
  const [repoError, setRepoError] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>(['full']);
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('full');
  // The account's own NEAR AI Cloud key and models: the only source. null until loaded; there is no hosted panel.
  const [own, setOwn] = useState<AccountKeyView | null>(null);
  const [ownError, setOwnError] = useState(false);
  const [tab, setTab] = useState<DashTab>('review');
  const ready = keyReady(own ?? undefined);

  const loadOwn = async () => {
    setOwnError(false);
    try {
      const { providers } = await api.listAccountKeys();
      const view = providers.find((item) => item.provider === OWN_PROVIDER) ?? null;
      setOwn(view);
      if (!view) setOwnError(true);
      // No key or no model yet: open the key panel first.
      else if (!keyReady(view)) setTab((current) => (current === 'review' ? 'settings' : current));
    } catch {
      setOwn(null);
      setOwnError(true);
    }
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const session = await api.session();
        if (!live) return;
        setName(displayName(session));
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
        setPhase((current) => (current === 'ready' ? current : 'anonymous'));
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

  const onSignedIn = async (session: SessionAccount) => {
    setName(displayName(session));
    setPhase('ready');
    setError(null);
    void loadOwn();
    try {
      const listed = await api.listMine();
      setRequests(listed.requests);
    } catch (caught) {
      setError(toAppError(caught).code);
    }
  };

  const signOut = async () => {
    if (pending) return;
    setPending('logout');
    setError(null);
    try {
      await api.logout();
      setName(null);
      setRequests([]);
      setRepo('');
      setRepoError(null);
      setOwn(null);
      setOwnError(false);
      setTab('review');
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
    if (scopes.length === 0 || !ready) return;
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
      await api.createDashboardJob({ repo: repo.trim(), scopes, source: OWN_PROVIDER, ...modeOpt });
      setRepo('');
      const listed = await api.listMine();
      setRequests(listed.requests);
      setTab('history');
    } catch (caught) {
      const appError = toAppError(caught);
      if (appError.code === 'REPO_INVALID') setRepoError(messageFor(appError.code));
      else { setError(appError.code); setDetail(appError.message); }
    } finally {
      setPending(null);
    }
  };

  if (phase === 'loading') return <p role="status">Loading…</p>;

  if (phase === 'anonymous' || !name) {
    return (
      <>
        {error ? <Alert>{messageFor(error)}</Alert> : null}
        <SignInPanel onSignedIn={(session) => { void onSignedIn(session); }} />
      </>
    );
  }

  return (
    <>
      <div className="request-row">
        <span>Signed in as <strong>{name}</strong></span>
        <Button variant="secondary" onClick={() => void signOut()} busy={pending === 'logout'}>Log out</Button>
      </div>
      <ReportTabs
        label="Dashboard"
        selected={tab}
        onSelect={(id) => setTab(id as DashTab)}
        tabs={[
          {
            id: 'review',
            label: 'New review',
            content: (
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
                {ready && own ? (
                  <p className="muted" data-testid="review-source">
                    Reviews run on your {own.label} key with {own.models.length} model{own.models.length === 1 ? '' : 's'}; {own.models[0]} orchestrates.
                    You pay NEAR AI directly; OmniSwarm charges nothing.
                  </p>
                ) : (
                  <div className="flow-step" data-testid="review-source">
                    <p>{OWN_KEY_PROMPT}</p>
                    <Button type="button" variant="secondary" onClick={() => setTab('settings')}>Add your NEAR AI key</Button>
                  </div>
                )}
                <Button type="submit" busy={pending === 'submit'} disabled={pending !== null || scopes.length === 0 || !ready}>Submit</Button>
                {detail ? <Alert>{detail}</Alert> : error ? <Alert>{messageFor(error)}</Alert> : null}
              </form>
            ),
          },
          {
            id: 'history',
            label: 'Review history',
            content: requests.length === 0 ? <p>No reviews yet.</p> : (
              <ul className="request-list" aria-label="Request history">{requests.map((row) => <Row key={row.requestId} row={row} />)}</ul>
            ),
          },
          {
            id: 'settings',
            label: 'Settings',
            content: (
              <>
                <p>{OWN_KEY_PROMPT}</p>
                <p className="muted">Your key is stored encrypted, shown only as a fingerprint, and used for your own reviews only. Save at least one model; the first one orchestrates.</p>
                {own ? <AccountKeyPanel view={own} onChange={setOwn} /> : null}
                {ownError ? <Alert>Your NEAR AI Cloud key settings could not be loaded. Reload the page to try again.</Alert> : null}
              </>
            ),
          },
        ]}
      />
      <Donate variant="footer" />
    </>
  );
}
