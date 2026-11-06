'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, localReportHref, type LocalJobDetail, type LocalJobRequest } from '@/lib/api/client';
import { messageFor, toAppError, type AppErrorCode } from '@/lib/api/errors';
import type { Status } from '@/lib/api/schema.gen';
import { parseRepoInput } from '@/lib/repo';
import { statusLabel } from '../request/Timeline';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { Pill, type Tone } from '../ui/Pill';

const KNOWN: readonly Status[] = ['queued', 'running', 'publishing', 'done', 'failed', 'refunded'];

function isKnown(status: string): status is Status {
  return (KNOWN as readonly string[]).includes(status);
}

function toneOf(status: string): Tone {
  if (status === 'done') return 'good';
  if (status === 'failed' || status === 'refunded') return 'bad';
  return 'info';
}

export function LocalJobs() {
  const [path, setPath] = useState('');
  const [github, setGithub] = useState('');
  const [pathError, setPathError] = useState<string | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [error, setError] = useState<AppErrorCode | null>(null);
  const [pending, setPending] = useState(false);
  const [jobs, setJobs] = useState<LocalJobDetail[] | null>(null);

  const load = useCallback(async () => {
    const { jobs: listed } = await api.listLocalJobs();
    setJobs(await Promise.all(listed.map((job) => api.getLocalJob(job.id))));
  }, []);

  useEffect(() => {
    let live = true;
    const refresh = () => load().catch((caught: unknown) => { if (live) setError(toAppError(caught).code); });
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [load]);

  const clearFieldErrors = () => {
    setPathError(null);
    setGithubError(null);
  };

  const send = async (body: LocalJobRequest) => {
    setPending(true);
    setError(null);
    try {
      await api.createLocalJob(body);
      setPath('');
      setGithub('');
      clearFieldErrors();
      await load();
    } catch (caught) {
      setError(toAppError(caught).code);
    } finally {
      setPending(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const pathValue = path.trim();
    const githubValue = github.trim();
    if (!pathValue && !githubValue) {
      const message = 'Enter a local path or a GitHub repository.';
      setPathError(message);
      setGithubError(message);
      return;
    }
    if (pathValue && githubValue) {
      const message = 'Enter either a local path or a GitHub repository, not both.';
      setPathError(message);
      setGithubError(message);
      return;
    }
    if (pathValue) {
      if (!pathValue.startsWith('/')) {
        setPathError('Use an absolute path.');
        setGithubError(null);
        return;
      }
      void send({ path: pathValue });
      return;
    }
    if (!parseRepoInput(githubValue)) {
      setPathError(null);
      setGithubError(messageFor('REPO_INVALID'));
      return;
    }
    void send({ github: githubValue });
  };

  return (
    <Panel title="Local job">
      <p className="muted">
        The local job runs a scripted reviewer with no paid model call. A real model review stays{' '}
        <code>./bin/audit run --repo {'<path>'}</code> or <code>--github owner/repo</code>.
      </p>
      <form className="quote-form" onSubmit={submit} noValidate>
        <div className="field-row">
          <Field
            label="Local repository path"
            name="path"
            placeholder="/absolute/path/to/repo"
            hint="Absolute path on the machine running the API."
            autoComplete="off"
            spellCheck={false}
            value={path}
            onChange={(event) => { setPath(event.target.value); clearFieldErrors(); }}
            error={pathError}
          />
          <Field
            label="GitHub repository"
            name="github"
            placeholder="owner/name or https://github.com/owner/name"
            hint="owner/name or a github.com URL, with an optional @ref."
            autoComplete="off"
            spellCheck={false}
            value={github}
            onChange={(event) => { setGithub(event.target.value); clearFieldErrors(); }}
            error={githubError}
          />
        </div>
        <Button type="submit" busy={pending}>Submit</Button>
      </form>
      {error ? <Alert>{messageFor(error)}</Alert> : null}
      {jobs === null ? <p role="status">Loading local jobs…</p> : jobs.length === 0 ? <p>No local jobs yet.</p> : (
        <ul className="request-list" aria-label="Local jobs">
          {jobs.map((job) => (
            <li key={job.id} className="request-row">
              <span className="request-row__repo">{job.ref ? `${job.source}@${job.ref}` : job.source}</span>
              <Pill tone={toneOf(job.status)}>{isKnown(job.status) ? statusLabel(job.status) : job.status}</Pill>
              <time className="muted" dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString()}</time>
              {job.status === 'done' && job.pdfReady ? <a href={localReportHref(job.id)}>Download PDF</a> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
