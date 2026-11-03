import type { Db } from '../pool.ts';

export type NonceState = 'ok' | 'missing' | 'used' | 'expired';

export async function issueNonce(db: Db, nonce: string, now: Date, expiresAt: Date, ip: string): Promise<void> {
  await db.query('INSERT INTO nonce (nonce, created_at, expires_at, ip) VALUES ($1, $2, $3, $4)', [nonce, now, expiresAt, ip]);
}

/** Read-only check, so a dead challenge is refused before any signature or RPC work. */
export async function peekNonce(db: Db, nonce: string, now: Date): Promise<NonceState> {
  const result = await db.query<{ used_at: Date | null; expires_at: Date }>('SELECT used_at, expires_at FROM nonce WHERE nonce = $1', [nonce]);
  const row = result.rows[0];
  if (!row) return 'missing';
  if (row.used_at) return 'used';
  return row.expires_at.getTime() <= now.getTime() ? 'expired' : 'ok';
}

/** Consume once: exactly one concurrent caller gets 'ok'. */
export async function consumeNonce(db: Db, nonce: string, now: Date): Promise<NonceState> {
  const updated = await db.query(
    'UPDATE nonce SET used_at = $2 WHERE nonce = $1 AND used_at IS NULL AND expires_at > $2 RETURNING nonce', [nonce, now]);
  if (updated.rowCount === 1) return 'ok';
  const state = await peekNonce(db, nonce, now);
  return state === 'ok' ? 'used' : state;
}

export async function pruneNonces(db: Db, before: Date): Promise<number> {
  const result = await db.query('DELETE FROM nonce WHERE expires_at < $1', [before]);
  return result.rowCount ?? 0;
}
