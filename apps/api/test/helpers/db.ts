// Integration tests get their own database on the server DATABASE_URL points at (created per test
// file, dropped afterwards), so they never truncate anyone's data. Without DATABASE_URL they skip.
import crypto from 'node:crypto';
import pg from 'pg';

export const SERVER_URL = process.env.DATABASE_URL ?? '';
export const NEEDS_DB = SERVER_URL
  ? {}
  : { skip: 'DATABASE_URL is not set: integration tests create a throwaway database on that server' };

function withDatabase(url: string, name: string): string {
  const next = new URL(url);
  next.pathname = `/${name}`;
  return next.toString();
}

export interface TestDatabase { url: string; drop(): Promise<void> }

export async function freshDatabase(label: string): Promise<TestDatabase> {
  const name = `t_${label.replace(/[^a-z0-9]/g, '_')}_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: SERVER_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return {
    url: withDatabase(SERVER_URL, name),
    async drop() {
      const client = new pg.Client({ connectionString: SERVER_URL });
      await client.connect();
      try {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await client.end();
      }
    },
  };
}
