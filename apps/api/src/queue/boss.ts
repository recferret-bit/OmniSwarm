// pg-boss in the intake database (schema `pgboss`). Only `npm run db:migrate` installs or upgrades the
// pg-boss schema; the API (sender) and workers start with migrate:false, so a replica never changes DDL.
import { PgBoss } from 'pg-boss';
import type { Config } from '../config/load.ts';

export const BOSS_SCHEMA = 'pgboss';
export type BossRole = 'install' | 'sender' | 'worker';

export function createBoss(config: Config, role: BossRole): PgBoss {
  const boss = new PgBoss({
    connectionString: config.db.url,
    schema: BOSS_SCHEMA,
    max: role === 'worker' ? config.queue.concurrency + 3 : 3,
    application_name: `omniswarm-${role}`,
    instanceName: config.queue.workerId && role === 'worker' ? `omniswarm-worker-${config.queue.workerId}` : `omniswarm-${role}`,
    migrate: role === 'install',
    createSchema: role === 'install',
    // Only workers expire jobs, fail jobs with a missed heartbeat and run cron schedules.
    supervise: role === 'worker',
    schedule: role === 'worker',
    superviseIntervalSeconds: config.queue.monitorS,
    monitorIntervalSeconds: config.queue.monitorS,
  });
  return boss;
}

export type { PgBoss };
