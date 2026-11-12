'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ReportTabs } from '@/components/report/ReportTabs';
import { statusLabel } from '@/components/request/Timeline';
import type { Status } from '@/lib/api/schema.gen';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Pill, type Tone } from '@/components/ui/Pill';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { publicAdminProviders } from '@omniswarm/schemas/providers-public';

interface StatusView { set: boolean; fingerprint: string | null }
// One entry per provider whose catalog entry takes an operator key on this page (packages/schemas/providers-public.mjs).
const ADMIN_PROVIDERS = publicAdminProviders();
type Keys = Record<string, StatusView>;
interface Job {
  id: string; account: string; repo: string; status: string; scope: string;
  theme: string | null; parentId: string | null; failureCause: string | null; createdAt: string;
}
interface Activity { freeChecks: boolean; jobs: Job[] }

const KNOWN: readonly Status[] = ['awaiting_payment', 'queued', 'running', 'publishing', 'done', 'failed', 'refunded', 'expired'];

function isStatus(value: string): value is Status {
  return (KNOWN as readonly string[]).includes(value);
}

function toneFor(status: string): Tone {
  if (status === 'done') return 'good';
  if (status === 'failed' || status === 'refunded' || status === 'expired') return 'bad';
  if (status === 'awaiting_payment') return 'warn';
  if (status === 'queued' || status === 'running' || status === 'publishing') return 'info';
  return 'neutral';
}

function labelFor(status: string): string {
  return isStatus(status) ? statusLabel(status) : status;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function group(jobs: Job[]): Map<string, Job[]> {
  const accounts = new Map<string, Job[]>();
  for (const job of jobs) {
    const list = accounts.get(job.account) ?? [];
    list.push(job);
    accounts.set(job.account, list);
  }
  return accounts;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'include' });
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in at the browser prompt, then reload.' : 'Could not read the admin view');
  return response.json() as Promise<T>;
}

function JobLink({ job }: { job: Job }) {
  const label = job.theme ? `${job.repo} · ${job.theme}` : job.repo;
  return <Link href={`/r/${job.id}`} className="request-row__repo" title={job.id}>{label}</Link>;
}

function Operators({ jobs }: { jobs: Job[] | null }) {
  if (!jobs) return <p role="status">Loading operators.</p>;
  const accounts = [...group(jobs).entries()];
  if (accounts.length === 0) return <p>No operators have posted a review yet.</p>;
  return (
    <div className="admin-stack">
      {accounts.map(([account, rows]) => (
        <Panel key={account} title={<>{account} <Pill>{rows.length}</Pill></>}>
          <ul className="request-list">
            {rows.map((job) => (
              <li key={job.id} className="request-row">
                <JobLink job={job} />
                <Pill tone={toneFor(job.status)}>{labelFor(job.status)}</Pill>
                <span className="muted">{job.scope}{job.parentId ? ' · split' : ''}</span>
                <time className="muted" dateTime={job.createdAt}>{when(job.createdAt)}</time>
                {job.failureCause ? <span>{job.failureCause}</span> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function Jobs({ jobs }: { jobs: Job[] | null }) {
  if (!jobs) return <p role="status">Loading jobs.</p>;
  if (jobs.length === 0) return <p>No jobs yet.</p>;
  return (
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">Jobs</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Account</th>
            <th scope="col">Status</th>
            <th scope="col">Scope</th>
            <th scope="col">Theme</th>
            <th scope="col">Posted</th>
            <th scope="col">Failure</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <th scope="row"><JobLink job={job} /></th>
              <td>{job.account}</td>
              <td><Pill tone={toneFor(job.status)}>{labelFor(job.status)}</Pill></td>
              <td>{job.scope}</td>
              <td>{job.theme ?? '—'}</td>
              <td><time dateTime={job.createdAt}>{when(job.createdAt)}</time></td>
              <td>{job.failureCause ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyLine({ name, view }: { name: string; view: StatusView | null }) {
  if (!view) return <Stat label={name} value="…" />;
  return (
    <Stat
      label={name}
      value={<>
        <Pill tone={view.set ? 'good' : 'warn'}>{view.set ? 'Set' : 'Not set'}</Pill>
        {view.fingerprint ? <span className="muted"> {view.fingerprint}</span> : null}
      </>}
    />
  );
}

export default function AdminPage() {
  const [keys, setKeys] = useState<Keys | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([readJson<Keys>('/api/operator/providers'), readJson<Activity>('/api/operator/activity')]).then(([nextKeys, nextActivity]) => {
      if (!live) return;
      setKeys(nextKeys);
      setActivity(nextActivity);
    }).catch((caught: unknown) => {
      if (live) setError(caught instanceof Error ? caught.message : 'Could not read the admin view');
    });
    return () => { live = false; };
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/operator/providers', {
        method: 'PUT',
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(Object.entries(drafts).filter(([, value]) => value))),
      });
      if (!response.ok) throw new Error('The keys were not saved');
      setKeys(await response.json() as Keys);
      setDrafts({});
      setNotice('Keys saved. A blank field kept the key already stored.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The keys were not saved');
    } finally {
      setPending(false);
    }
  };

  const setFree = async (freeChecks: boolean) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/operator/settings', {
        method: 'PUT', credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ freeChecks }),
      });
      if (!response.ok) throw new Error('The setting was not saved');
      const saved = await response.json() as { freeChecks: boolean };
      setActivity((current) => current ? { ...current, freeChecks: saved.freeChecks } : current);
      setNotice(saved.freeChecks ? 'Free checks are on.' : 'Payment is required before a review is queued.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The setting was not saved');
    } finally {
      setPending(false);
    }
  };

  const jobs = activity?.jobs ?? null;
  const accounts = jobs ? group(jobs) : null;
  const inProgress = jobs ? jobs.filter((job) => job.status === 'queued' || job.status === 'running' || job.status === 'publishing').length : '—';
  const failed = jobs ? jobs.filter((job) => job.status === 'failed').length : '—';

  return (
    <>
      <h1>Admin</h1>
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      <Panel>
        <p className="muted">This page is separate from the public site. The browser asked for the admin user before it loaded.</p>
        <StatGrid label="Activity">
          <Stat label="Operators" value={accounts ? accounts.size : '—'} />
          <Stat label="Jobs" value={jobs ? jobs.length : '—'} />
          <Stat label="In progress" value={inProgress} />
          <Stat label="Failed" value={failed} />
        </StatGrid>
        <ReportTabs
          label="Admin"
          tabs={[
            { id: 'operators', label: 'Operators', content: <Operators jobs={jobs} /> },
            { id: 'jobs', label: 'Jobs', content: <Jobs jobs={jobs} /> },
            {
              id: 'settings',
              label: 'Settings',
              content: (
                <div className="admin-stack">
                  <section className="admin-stack">
                    <h2 className="panel__title">Provider keys</h2>
                    <StatGrid label="Provider keys">
                      {ADMIN_PROVIDERS.map((provider) => <KeyLine key={provider.id} name={provider.label} view={keys?.[provider.id] ?? null} />)}
                    </StatGrid>
                    <form className="quote-form" onSubmit={(event) => void save(event)}>
                      {ADMIN_PROVIDERS.map((provider) => (
                        <Field
                          key={provider.id}
                          label={`${provider.label} API key`}
                          name={provider.id}
                          type="password"
                          autoComplete="off"
                          value={drafts[provider.id] ?? ''}
                          onChange={(event) => setDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}
                          hint="Leave blank to keep the saved key."
                        />
                      ))}
                      <Button type="submit" busy={pending} disabled={!keys}>Save keys</Button>
                    </form>
                  </section>
                  <section className="admin-stack">
                    <h2 id="free-checks" className="panel__title">Free checks {activity ? <Pill tone={activity.freeChecks ? 'good' : 'neutral'}>{activity.freeChecks ? 'On' : 'Off'}</Pill> : null}</h2>
                    <div role="radiogroup" aria-labelledby="free-checks" className="choice">
                    <label className="choice__option">
                      <input type="radio" name="free" checked={activity?.freeChecks === true} disabled={pending || !activity} onChange={() => void setFree(true)} />
                      <span className="choice__copy">
                        <strong>Allow free checks</strong>
                        <span className="muted">Visitors queue a review from the landing page without a wallet.</span>
                      </span>
                    </label>
                    <label className="choice__option">
                      <input type="radio" name="free" checked={activity?.freeChecks === false} disabled={pending || !activity} onChange={() => void setFree(false)} />
                      <span className="choice__copy">
                        <strong>Require payment</strong>
                        <span className="muted">Visitors sign and pay before a review is queued.</span>
                      </span>
                    </label>
                    </div>
                  </section>
                </div>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
