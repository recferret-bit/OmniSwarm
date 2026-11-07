'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';

interface Status { zai: { set: boolean; fingerprint: string | null }; openrouter: { set: boolean; fingerprint: string | null } }

async function readStatus(): Promise<Status> {
  const response = await fetch('/api/operator/providers', { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'include' });
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in at the browser prompt, then reload.' : 'Could not read the keys');
  return response.json() as Promise<Status>;
}

export default function AdminPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [zai, setZai] = useState('');
  const [openrouter, setOpenrouter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;
    void readStatus().then((next) => { if (live) setStatus(next); }).catch((caught: unknown) => {
      if (live) setError(caught instanceof Error ? caught.message : 'Could not read the keys');
    });
    return () => { live = false; };
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/operator/providers', {
        method: 'PUT',
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ ...(zai ? { zai } : {}), ...(openrouter ? { openrouter } : {}) }),
      });
      if (!response.ok) throw new Error('The keys were not saved');
      setStatus(await response.json() as Status);
      setZai('');
      setOpenrouter('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The keys were not saved');
    } finally {
      setPending(false);
    }
  };

  const line = (name: string, view: Status['zai']) => view.set ? `${name} is set (${view.fingerprint})` : `${name} is not set`;

  return (
    <Panel title="Provider keys">
      <p className="muted">This page is separate from the site. The browser asked for the admin user before it loaded.</p>
      {status ? <p>{line('Z.AI', status.zai)}</p> : null}
      {status ? <p>{line('OpenRouter', status.openrouter)}</p> : null}
      <form className="quote-form" onSubmit={(event) => void save(event)}>
        <Field label="Z.AI API key" name="zai" type="password" autoComplete="off" value={zai} onChange={(event) => setZai(event.target.value)} hint="Leave blank to keep the saved key." />
        <Field label="OpenRouter API key" name="openrouter" type="password" autoComplete="off" value={openrouter} onChange={(event) => setOpenrouter(event.target.value)} hint="Leave blank to keep the saved key." />
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" busy={pending} disabled={!status}>Save keys</Button>
      </form>
    </Panel>
  );
}
