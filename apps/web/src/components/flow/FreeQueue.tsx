'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';

export function FreeQueue({ repo }: { repo: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const queue = async () => {
    setPending(true);
    setError(null);
    let scopes = ['full'];
    try {
      const saved = JSON.parse(sessionStorage.getItem('omniswarm-scope') ?? '[]') as unknown;
      if (Array.isArray(saved) && saved.every((item) => typeof item === 'string') && saved.length) scopes = saved;
    } catch { /* keep full */ }
    try {
      const response = await fetch('/api/free/jobs', {
        method: 'POST', credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ repo, scopes }),
      });
      const body = await response.json() as { requestId?: string; error?: { message?: string } };
      if (!response.ok || !body.requestId) throw new Error(body.error?.message ?? 'The review was not queued');
      router.push(`/r/${body.requestId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The review was not queued');
      setPending(false);
    }
  };

  return (
    <>
      <Button onClick={() => void queue()} busy={pending}>Queue free review</Button>
      {error ? <Alert>{error}</Alert> : null}
    </>
  );
}
