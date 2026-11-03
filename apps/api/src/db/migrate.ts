// Numbered SQL migrations (NNN_name.sql), one ledger table per migration set. Each file runs in its own
// transaction. Callers hold MIGRATION_LOCK so concurrent deploy steps serialize; the API and worker
// never call this at boot. The core set is every deployment's schema; other sets (the mock chain's
// tables) live beside the code that owns them and are applied only where that code may run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTransaction, type Pool } from './pool.ts';

export const MIGRATION_LOCK = 'omniswarm:migrate';

export interface MigrationSet { dir: string; ledger: string }

export const CORE_MIGRATIONS: MigrationSet = {
  dir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations'),
  ledger: 'schema_migrations',
};

export interface MigrationFile { version: number; name: string; file: string }

function ledgerName(set: MigrationSet): string {
  if (!/^[a-z_]{1,63}$/.test(set.ledger)) throw new Error(`bad migration ledger name ${set.ledger}`);
  return set.ledger;
}

export function listMigrations(set: MigrationSet = CORE_MIGRATIONS): MigrationFile[] {
  const files = fs.readdirSync(set.dir).filter((name) => name.endsWith('.sql')).sort();
  const seen = new Set<number>();
  return files.map((name) => {
    const match = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(name);
    if (!match) throw new Error(`migration file name must be NNN_name.sql: ${name}`);
    const version = Number(match[1]);
    if (seen.has(version)) throw new Error(`duplicate migration version ${version}`);
    seen.add(version);
    return { version, name: match[2] as string, file: path.join(set.dir, name) };
  });
}

/** Apply pending migrations of one set. The caller must hold MIGRATION_LOCK. Returns the applied versions. */
export async function applyMigrations(pool: Pool, set: MigrationSet = CORE_MIGRATIONS): Promise<number[]> {
  const ledger = ledgerName(set);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${ledger} (
    version int PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await pool.query<{ version: number }>(`SELECT version FROM ${ledger}`)).rows.map((row) => row.version));
  const applied: number[] = [];
  for (const migration of listMigrations(set)) {
    if (done.has(migration.version)) continue;
    const sql = fs.readFileSync(migration.file, 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query(`INSERT INTO ${ledger} (version, name) VALUES ($1, $2)`, [migration.version, migration.name]);
    });
    applied.push(migration.version);
  }
  return applied;
}

/** The highest version on disk, for readiness checks. */
export function latestVersion(set: MigrationSet = CORE_MIGRATIONS): number {
  return listMigrations(set).at(-1)?.version ?? 0;
}

export async function currentVersion(pool: Pool, set: MigrationSet = CORE_MIGRATIONS): Promise<number> {
  const ledger = ledgerName(set);
  const exists = await pool.query(`SELECT to_regclass($1) AS t`, [ledger]);
  if (!exists.rows[0]?.t) return 0;
  const result = await pool.query<{ v: number | null }>(`SELECT max(version) AS v FROM ${ledger}`);
  return result.rows[0]?.v ?? 0;
}
