// Numbered SQL migrations (NNN_name.sql) with a schema_migrations ledger. Each file runs in its own
// transaction. Callers hold MIGRATION_LOCK so concurrent deploy steps serialize; the API and worker
// never call this at boot.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTransaction, type Pool } from './pool.ts';

export const MIGRATION_LOCK = 'omniswarm:migrate';
export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface MigrationFile { version: number; name: string; file: string }

export function listMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
  const seen = new Set<number>();
  return files.map((name) => {
    const match = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(name);
    if (!match) throw new Error(`migration file name must be NNN_name.sql: ${name}`);
    const version = Number(match[1]);
    if (seen.has(version)) throw new Error(`duplicate migration version ${version}`);
    seen.add(version);
    return { version, name: match[2] as string, file: path.join(dir, name) };
  });
}

/** Apply pending migrations. The caller must hold MIGRATION_LOCK. Returns the applied versions. */
export async function applyMigrations(pool: Pool, dir = MIGRATIONS_DIR): Promise<number[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version int PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await pool.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map((row) => row.version));
  const applied: number[] = [];
  for (const migration of listMigrations(dir)) {
    if (done.has(migration.version)) continue;
    const sql = fs.readFileSync(migration.file, 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [migration.version, migration.name]);
    });
    applied.push(migration.version);
  }
  return applied;
}

/** The highest version on disk, for readiness checks. */
export function latestVersion(dir = MIGRATIONS_DIR): number {
  return listMigrations(dir).at(-1)?.version ?? 0;
}

export async function currentVersion(pool: Pool): Promise<number> {
  const exists = await pool.query(`SELECT to_regclass('schema_migrations') AS t`);
  if (!exists.rows[0]?.t) return 0;
  const result = await pool.query<{ v: number | null }>('SELECT max(version) AS v FROM schema_migrations');
  return result.rows[0]?.v ?? 0;
}
