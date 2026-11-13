import pg from 'pg';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;
/** Anything that runs a query: the pool, or a client inside a transaction. */
export type Db = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

// numeric(40,0) and bigint come back as strings; keep them as strings (ids).
export function createPool(url: string, max = 10): Pool {
  const pool = new pg.Pool({ connectionString: url, max });
  // An idle client that loses its connection must not crash the process.
  pool.on('error', () => {});
  return pool;
}

export async function withTransaction<T>(pool: Pool, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Hold a session-level advisory lock for the duration of fn. The lock lives on one connection, so a
 * crashed process releases it when its connection closes. `key` is hashed to a bigint by Postgres.
 */
export async function withAdvisoryLock<T>(pool: Pool, key: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key]);
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
    }
  } finally {
    client.release();
  }
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pgError = error as { code?: string; constraint?: string };
  return pgError?.code === '23505' && (constraint === undefined || pgError.constraint === constraint);
}
