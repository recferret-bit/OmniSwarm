import type { Db } from '../pool.ts';

/**
 * Fixed-window counter shared by every replica. Uses the database clock so replicas with skewed
 * clocks still agree. Returns the count after this hit and the milliseconds left in the window.
 */
export async function hit(db: Db, key: string, windowMs: number): Promise<{ current: number; ttl: number }> {
  const result = await db.query<{ count: number; ttl: number }>(
    `INSERT INTO rate_limit (key, count, reset_at) VALUES ($1, 1, now() + $2 * interval '1 millisecond')
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limit.reset_at <= now() THEN 1 ELSE rate_limit.count + 1 END,
       reset_at = CASE WHEN rate_limit.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limit.reset_at END
     RETURNING count, greatest(0, ceil(extract(epoch FROM reset_at - now()) * 1000))::int AS ttl`,
    [key, windowMs]);
  const row = result.rows[0];
  return { current: row?.count ?? 1, ttl: row?.ttl ?? windowMs };
}

export async function peek(db: Db, key: string): Promise<{ current: number; ttl: number }> {
  const result = await db.query<{ count: number; ttl: number }>(
    `SELECT CASE WHEN reset_at <= now() THEN 0 ELSE count END AS count,
            greatest(0, ceil(extract(epoch FROM reset_at - now()) * 1000))::int AS ttl
     FROM rate_limit WHERE key = $1`, [key]);
  return { current: result.rows[0]?.count ?? 0, ttl: result.rows[0]?.ttl ?? 0 };
}

export async function pruneRateLimits(db: Db): Promise<number> {
  const result = await db.query(`DELETE FROM rate_limit WHERE reset_at < now() - interval '1 hour'`);
  return result.rowCount ?? 0;
}
