// The MockChainAdapter's tables are not part of the production schema. They are a migration set of
// their own (src/chain/mock/migrations, ledger `mock_chain_migrations`), applied by `db:migrate` only
// when CHAIN_ADAPTER=mock outside production. Before this split they were core migration 002, so a
// production database may still hold them: `dropMockChainTables` removes them there, and refuses if
// any holds a row (a mock chain was run against that database, which an operator must look at).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrationSet } from '../../db/migrate.ts';
import { withTransaction, type Pool } from '../../db/pool.ts';

export const MOCK_CHAIN_MIGRATIONS: MigrationSet = {
  dir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations'),
  ledger: 'mock_chain_migrations',
};

const MOCK_TABLE = /^mock_chain_[a-z_]+$/;

/** Drop every empty mock_chain_* table and the mock ledger. Returns the dropped tables. */
export async function dropMockChainTables(pool: Pool): Promise<string[]> {
  return withTransaction(pool, async (client) => {
    const found = await client.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name LIKE 'mock\\_chain\\_%' ORDER BY table_name`);
    const tables = found.rows.map((row) => row.name).filter((name) => MOCK_TABLE.test(name));
    if (!tables.length) return [];
    await client.query(`LOCK TABLE ${tables.join(', ')} IN ACCESS EXCLUSIVE MODE`);
    const used: string[] = [];
    for (const table of tables) {
      if (table === MOCK_CHAIN_MIGRATIONS.ledger) continue;
      const rows = await client.query(`SELECT 1 FROM ${table} LIMIT 1`);
      if (rows.rowCount) used.push(table);
    }
    if (used.length) throw new Error(`refusing to drop mock chain tables that hold rows in production: ${used.join(', ')}`);
    await client.query(`DROP TABLE ${tables.join(', ')}`);
    return tables;
  });
}
