'use client';

import { useState, type FormEvent } from 'react';
import { messageFor } from '@/lib/api/errors';
import { isAccountId } from '@/lib/repo';
import { selectBusy, useRequestFlow } from '@/stores/request-flow';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';

export function QuoteForm() {
  const [repo, setRepo] = useState('');
  const [deployed, setDeployed] = useState('');
  const requestQuote = useRequestFlow((state) => state.requestQuote);
  const busy = useRequestFlow(selectBusy);
  const quoting = useRequestFlow((state) => state.step === 'quoting');
  const invalid = useRequestFlow((state) => state.error?.code === 'REPO_INVALID');
  const deployedError = deployed && !isAccountId(deployed.trim()) ? 'Not a NEAR account id' : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (deployedError) return;
    void requestQuote(repo, deployed);
  };

  return (
    <form className="quote-form" onSubmit={submit} noValidate>
      <Field
        label="GitHub repository"
        name="repo"
        placeholder="owner/name or https://github.com/owner/name"
        autoComplete="off"
        spellCheck={false}
        value={repo}
        onChange={(event) => setRepo(event.target.value)}
        error={invalid ? messageFor('REPO_INVALID') : null}
        required
      />
      <Field
        label="Deployed NEAR account (optional)"
        name="deployed"
        hint="The contract account that runs this code. The guard uses it."
        autoComplete="off"
        spellCheck={false}
        value={deployed}
        onChange={(event) => setDeployed(event.target.value)}
        error={deployedError}
      />
      <Button type="submit" busy={quoting} disabled={busy}>Get quote</Button>
    </form>
  );
}
