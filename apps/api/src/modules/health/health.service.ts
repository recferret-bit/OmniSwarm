// /api/health (liveness plus the public status block) and /api/ready (can this replica serve:
// database reachable, migrations applied, queue installed). The chain probe is cached so a busy
// health check never hammers the RPC.
import type { ChainHealth, ChainPort } from '../../chain/port.ts';
import type { Config } from '../../config/load.ts';
import { currentVersion, latestVersion } from '../../db/migrate.ts';
import type { Pool } from '../../db/pool.ts';
import { queueDepth } from '../../db/repositories/requests.ts';
import type { PgBoss } from '../../queue/boss.ts';
import { REVIEW_QUEUE } from '../../queue/review-queue.ts';

export interface HealthDeps { config: Config; pool: Pool; chain: ChainPort; boss: PgBoss }

const CHAIN_TTL_MS = 30_000;

export class HealthService {
  readonly #deps: HealthDeps;
  #chain: { at: number; value: ChainHealth } | null = null;

  constructor(deps: HealthDeps) {
    this.#deps = deps;
  }

  async #chainHealth(): Promise<ChainHealth> {
    if (this.#chain && Date.now() - this.#chain.at < CHAIN_TTL_MS) return this.#chain.value;
    const value = await this.#deps.chain.health().catch(() => ({ rpc: false, contract: false }));
    this.#chain = { at: Date.now(), value };
    return value;
  }

  async #workers(): Promise<number> {
    const instances = await this.#deps.boss.getInstances().catch(() => []);
    return instances.filter((instance) => instance.live && instance.workers.some((worker) => worker.queue === REVIEW_QUEUE)).length;
  }

  async health() {
    const [depth, workers, chain] = await Promise.all([queueDepth(this.#deps.pool), this.#workers(), this.#chainHealth()]);
    return { ok: true, network: this.#deps.config.intake.network, queueDepth: depth, workers, chain };
  }

  async ready() {
    const db = await this.#deps.pool.query('SELECT 1').then(() => true, () => false);
    const migrations = db && (await currentVersion(this.#deps.pool).catch(() => -1)) === latestVersion();
    const queue = db && (await this.#deps.boss.getQueue(REVIEW_QUEUE).then((found) => Boolean(found), () => false));
    return { ok: db && migrations && queue, db, queue, migrations };
  }
}
