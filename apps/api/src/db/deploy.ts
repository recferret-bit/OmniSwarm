// The whole deploy-time schema step: numbered SQL migrations, then the pg-boss schema and queues,
// under one advisory lock so concurrent deploys serialize. Used by `npm run db:migrate` and tests.
// The mock chain's tables are applied only for CHAIN_ADAPTER=mock outside production, and removed
// from a production database (src/chain/mock/schema.ts).
import type { Config } from '../config/load.ts';
import { createBoss } from '../queue/boss.ts';
import { installQueues } from '../queue/review-queue.ts';
import { applyMigrations, MIGRATION_LOCK } from './migrate.ts';
import { createPool, withAdvisoryLock, type Pool } from './pool.ts';

async function mockChainSchema(pool: Pool, config: Config): Promise<void> {
  if (config.env !== 'production' && config.chain.adapter !== 'mock') return;
  const { dropMockChainTables, MOCK_CHAIN_MIGRATIONS } = await import('../chain/mock/schema.ts');
  if (config.env === 'production') await dropMockChainTables(pool);
  else await applyMigrations(pool, MOCK_CHAIN_MIGRATIONS);
}

export async function migrateAll(config: Config): Promise<number[]> {
  const pool = createPool(config.db.url, 2);
  try {
    return await withAdvisoryLock(pool, MIGRATION_LOCK, async () => {
      const applied = await applyMigrations(pool);
      await mockChainSchema(pool, config);
      const boss = createBoss(config, 'install');
      await boss.start();
      try {
        await installQueues(boss, config);
      } finally {
        await boss.stop({ graceful: false, close: true });
      }
      return applied;
    });
  } finally {
    await pool.end();
  }
}
