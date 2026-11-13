// A signed-in account's own key for a provider whose catalog entry allows it (packages/schemas/providers.mjs
// keySources 'account'; today NEAR AI Cloud), and the models it chose. Stored sealed in Postgres
// (account_provider_key) so the API container and the host workers share it without a shared disk.
// AES-256-GCM under ACCOUNT_KEYS_SECRET; `account:<provider>:<account>` is the additional authenticated data.
// Responses and logs only ever see a fingerprint. The key reaches one engine spawn as that provider's key
// variable and nothing else.
import { accountPresetName, accountProviders, isModelId, providerById, type Provider } from '@omniswarm/schemas/providers';
import type { Db } from '../../db/pool.ts';
import { findAccountKey, saveAccountKey } from '../../db/repositories/account-keys.ts';
import { fail } from '../../shared/errors.ts';
import { open, seal } from './seal.ts';

export const MAX_ACCOUNT_MODELS = 6;

export interface AccountKeyView { provider: string; label: string; set: boolean; fingerprint: string | null; models: string[]; dataPolicy: string }

const aad = (provider: string, account: string) => `account:${provider}:${account}`;

/** The catalog entry for an account-key provider, or VALIDATION_ERROR. */
export function accountProvider(id: string): Provider {
  const provider = providerById(id);
  if (!provider || !accountProviders().some((item) => item.id === id)) fail('VALIDATION_ERROR', `${id} does not take account keys`);
  return provider;
}

function assertSecret(secret: string): void {
  if (secret.length < 32) fail('FORBIDDEN', 'Account provider keys are off: set ACCOUNT_KEYS_SECRET');
}

/** Trimmed, de-duplicated, at most MAX_ACCOUNT_MODELS, each a valid model id. Throws on a bad id. */
export function cleanModels(models: readonly string[]): string[] {
  const out = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  const bad = out.find((model) => !isModelId(model));
  if (bad !== undefined) throw new Error(`invalid model id ${JSON.stringify(bad)}`);
  if (out.length > MAX_ACCOUNT_MODELS) throw new Error(`at most ${MAX_ACCOUNT_MODELS} models`);
  return out;
}

export async function accountKeyStatus(db: Db, account: string, providerId: string): Promise<AccountKeyView> {
  const provider = accountProvider(providerId);
  const row = await findAccountKey(db, account, provider.id);
  return { provider: provider.id, label: provider.label, set: Boolean(row?.key), fingerprint: row?.key?.fingerprint ?? null, models: row?.models ?? [], dataPolicy: provider.dataPolicy };
}

/** `key`: undefined keeps it, '' clears it. `models`: undefined keeps them. */
export async function writeAccountKey(
  db: Db, secret: string, account: string, providerId: string, update: { key?: string; models?: readonly string[] }, now: Date,
): Promise<AccountKeyView> {
  const provider = accountProvider(providerId);
  assertSecret(secret);
  let models: string[] | undefined;
  try { models = update.models === undefined ? undefined : cleanModels(update.models); } catch (error) { fail('VALIDATION_ERROR', (error as Error).message); }
  const row = (await findAccountKey(db, account, provider.id)) ?? { account, provider: provider.id, key: null, models: [] };
  if (update.key !== undefined) row.key = update.key === '' ? null : seal(secret, update.key, aad(provider.id, account));
  if (models !== undefined) row.models = models;
  await saveAccountKey(db, row, now);
  return accountKeyStatus(db, account, provider.id);
}

/** The decrypted key for one engine spawn, or null (none saved, the secret rotated, or the row was moved). */
export async function readAccountKey(db: Db, secret: string, account: string, providerId: string): Promise<string | null> {
  if (secret.length < 32) return null;
  const row = await findAccountKey(db, account, providerId);
  if (!row?.key) return null;
  try { return open(secret, row.key, aad(providerId, account)); } catch { return null; }
}

/** `account-<provider>` and the account's saved models, or PRESET_NOT_ALLOWED. Used by the dashboard. */
export async function accountPreset(db: { pool: Db }, account: string, providerId: string): Promise<{ preset: string; models: string[] }> {
  const view = await accountKeyStatus(db.pool, account, providerId);
  if (!view.set || view.models.length === 0) fail('PRESET_NOT_ALLOWED', `Save your ${view.label} key and choose at least one model before queueing a review on it`);
  return { preset: accountPresetName(providerId), models: view.models };
}

export interface ModelList { source: 'live' | 'unavailable'; models: string[] }

/** The model ids the provider serves this key. Never throws: any failure is `unavailable`, and the page lets the user type an id. */
export async function listProviderModels(providerId: string, key: string, fetchImpl: typeof fetch = fetch): Promise<ModelList> {
  const provider = providerById(providerId);
  if (!provider?.baseUrl || !provider.modelsPath) return { source: 'unavailable', models: [] };
  try {
    const response = await fetchImpl(`${provider.baseUrl}${provider.modelsPath}`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { source: 'unavailable', models: [] };
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    const ids = (Array.isArray(body.data) ? body.data : []).map((item) => item?.id).filter((id): id is string => isModelId(id));
    return { source: 'live', models: [...new Set(ids)].sort().slice(0, 200) };
  } catch {
    return { source: 'unavailable', models: [] };
  }
}
