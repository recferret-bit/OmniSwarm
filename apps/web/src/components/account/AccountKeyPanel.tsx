'use client';

import { useState, type FormEvent } from 'react';
import { MODEL_ID_PATTERN } from '@omniswarm/schemas/providers-public';
import { api, type AccountKeyView } from '@/lib/api/client';
import { messageFor, toAppError } from '@/lib/api/errors';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Pill } from '../ui/Pill';

const MODEL_ID = new RegExp(MODEL_ID_PATTERN);
const MAX_MODELS = 6;

export interface AccountKeyPanelProps {
  view: AccountKeyView;
  onChange: (view: AccountKeyView) => void;
}

/**
 * The signed-in account's own key and models for one provider (any provider whose catalog entry takes account
 * keys). The key goes to the API once and is never shown again; only its fingerprint comes back.
 */
export function AccountKeyPanel({ view, onChange }: AccountKeyPanelProps) {
  const [key, setKey] = useState('');
  const [typed, setTyped] = useState('');
  const [listed, setListed] = useState<string[]>([]);
  const [listNote, setListNote] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<'key' | 'models' | 'list' | null>(null);
  const label = view.label;

  const run = async (kind: 'key' | 'models' | 'list', work: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setMessage(null);
    try {
      await work();
    } catch (caught) {
      const error = toAppError(caught);
      setMessage(error.message || messageFor(error.code));
    } finally {
      setBusy(null);
    }
  };

  const saveKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!key.trim()) return;
    void run('key', async () => {
      onChange(await api.saveAccountKey(view.provider, { key: key.trim() }));
      setKey('');
    });
  };

  const removeKey = () => void run('key', async () => { onChange(await api.saveAccountKey(view.provider, { key: '' })); setListed([]); });
  const saveModels = (models: string[]) => void run('models', async () => { onChange(await api.saveAccountKey(view.provider, { models })); });

  const toggle = (model: string, on: boolean) => {
    const next = on ? [...view.models, model] : view.models.filter((item) => item !== model);
    saveModels([...new Set(next)]);
  };

  const addTyped = () => {
    const model = typed.trim();
    if (!MODEL_ID.test(model)) { setMessage('That is not a model id.'); return; }
    if (view.models.length >= MAX_MODELS && !view.models.includes(model)) { setMessage(`Choose at most ${MAX_MODELS} models.`); return; }
    setTyped('');
    saveModels([...new Set([...view.models, model])]);
  };

  const load = () => void run('list', async () => {
    const result = await api.listProviderModels(view.provider);
    setListed(result.models);
    setListNote(result.source === 'live' ? null : `${label} did not return a model list. Type a model id below.`);
  });

  const shown = [...new Set([...view.models, ...listed])];

  return (
    <fieldset className="quote-form" aria-label={label}>
      <legend>{label} (your key)</legend>
      <p className="muted">
        The first model orchestrates and every chosen model reviews. {view.dataPolicy} Your key is stored
        encrypted, shown only as a fingerprint, and used for your own reviews only.
      </p>
      <div className="request-row">
        {view.set ? <Pill tone="good">Key saved · {view.fingerprint}</Pill> : <Pill tone="warn">No key</Pill>}
        {view.set ? <Button type="button" variant="secondary" onClick={removeKey} busy={busy === 'key'}>Remove key</Button> : null}
      </div>
      <form className="quote-form" onSubmit={saveKey} noValidate>
        <Field
          label={view.set ? `Replace ${label} API key` : `${label} API key`}
          name={`${view.provider}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button type="submit" busy={busy === 'key'} disabled={busy !== null || !key.trim()}>Save key</Button>
      </form>
      {view.set ? (
        <div className="quote-form">
          <Button type="button" variant="secondary" onClick={load} busy={busy === 'list'}>Load models from {label}</Button>
          {listNote ? <p className="muted">{listNote}</p> : null}
          {shown.map((model) => (
            <label key={model}>
              <input
                type="checkbox"
                name={`${view.provider}-models`}
                value={model}
                checked={view.models.includes(model)}
                disabled={busy !== null}
                onChange={(event) => toggle(model, event.target.checked)}
              />
              {' '}{model}{view.models[0] === model ? ' (orchestrator)' : ''}
            </label>
          ))}
          <Field
            label="Add a model id"
            name={`${view.provider}-model`}
            placeholder="for example deepseek-ai/DeepSeek-V4"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTyped(); } }}
          />
          <Button type="button" variant="secondary" onClick={addTyped} disabled={busy !== null || !typed.trim()}>Add model</Button>
        </div>
      ) : null}
      {message ? <Alert>{message}</Alert> : null}
    </fieldset>
  );
}

/** Ready to review: a key and at least one model. */
export function keyReady(view: AccountKeyView | undefined): boolean {
  return Boolean(view?.set && view.models.length > 0);
}
