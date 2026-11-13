// /api/health (liveness plus queue status) and /api/ready (can this replica serve: database reachable,
// migrations applied, queue installed).
import type { Config } from '../../config/load.ts';
import { currentVersion, latestVersion } from '../../db/migrate.ts';
import type { Pool } from '../../db/pool.ts';
import { queueDepth } from '../../db/repositories/requests.ts';
import type { PgBoss } from '../../queue/boss.ts';
import { REVIEW_QUEUE } from '../../queue/review-queue.ts';

export interface HealthDeps { config: Config; pool: Pool; boss: PgBoss }

export class HealthService {
  readonly #deps: HealthDeps;

  constructor(deps: HealthDeps) {
    this.#deps = deps;
  }

  async #workers(): Promise<number> {
    const instances = await this.#deps.boss.getInstances().catch(() => []);
    return instances.filter((instance) => instance.live && instance.workers.some((worker) => worker.queue === REVIEW_QUEUE)).length;
  }

  async health() {
    const [depth, workers] = await Promise.all([queueDepth(this.#deps.pool), this.#workers()]);
    return { ok: true, queueDepth: depth, workers };
  }

  async ready() {
    const db = await this.#deps.pool.query('SELECT 1').then(() => true, () => false);
    const migrations = db && (await currentVersion(this.#deps.pool).catch(() => -1)) === latestVersion();
    const queue = db && (await this.#deps.boss.getQueue(REVIEW_QUEUE).then((found) => Boolean(found), () => false));
    return { ok: db && migrations && queue, db, queue, migrations };
  }
}
