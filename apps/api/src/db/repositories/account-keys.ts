// `account_provider_key` (migration 010): one sealed key and model list per (account, provider).
import type { Db } from '../pool.ts';

export interface SealedKey { iv: string; tag: string; data: string; fingerprint: string }
export interface AccountKeyRow { account: string; provider: string; key: SealedKey | null; models: string[] }

interface Raw { account: string; provider: string; iv: string | null; tag: string | null; data: string | null; fingerprint: string | null; models: string[] }

function toRow(raw: Raw): AccountKeyRow {
  const key = raw.iv && raw.tag && raw.data && raw.fingerprint ? { iv: raw.iv, tag: raw.tag, data: raw.data, fingerprint: raw.fingerprint } : null;
  return { account: raw.account, provider: raw.provider, key, models: raw.models ?? [] };
}

export async function findAccountKey(db: Db, account: string, provider: string): Promise<AccountKeyRow | null> {
  const result = await db.query<Raw>(
    'SELECT account, provider, iv, tag, data, fingerprint, models FROM account_provider_key WHERE account = $1 AND provider = $2', [account, provider]);
  return result.rows[0] ? toRow(result.rows[0]) : null;
}

/** Upsert. A row with no key and no models is deleted instead. */
export async function saveAccountKey(db: Db, row: AccountKeyRow, now: Date): Promise<void> {
  if (!row.key && row.models.length === 0) {
    await db.query('DELETE FROM account_provider_key WHERE account = $1 AND provider = $2', [row.account, row.provider]);
    return;
  }
  await db.query(
    `INSERT INTO account_provider_key (account, provider, iv, tag, data, fingerprint, models, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (account, provider) DO UPDATE SET iv = EXCLUDED.iv, tag = EXCLUDED.tag, data = EXCLUDED.data,
       fingerprint = EXCLUDED.fingerprint, models = EXCLUDED.models, updated_at = EXCLUDED.updated_at`,
    [row.account, row.provider, row.key?.iv ?? null, row.key?.tag ?? null, row.key?.data ?? null, row.key?.fingerprint ?? null, row.models, now]);
}
