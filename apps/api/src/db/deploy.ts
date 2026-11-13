// The whole deploy-time schema step: numbered SQL migrations, then the pg-boss schema and queues,
// under one advisory lock so concurrent deploys serialize. Used by `npm run db:migrate` and tests.
import type { Config } from '../config/load.ts';
import { createBoss } from '../queue/boss.ts';
import { installQueues } from '../queue/review-queue.ts';
import { applyMigrations, MIGRATION_LOCK } from './migrate.ts';
import { createPool, withAdvisoryLock } from './pool.ts';

export async function migrateAll(config: Config): Promise<number[]> {
  const pool = createPool(config.db.url, 2);
  try {
    return await withAdvisoryLock(pool, MIGRATION_LOCK, async () => {
      const applied = await applyMigrations(pool);
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
