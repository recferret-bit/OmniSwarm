import type { CoreDeps } from '../container.ts';
import type { GitHubPort } from '../github/port.ts';
import type { GuardPort } from '../modules/guard/guard.port.ts';
import type { EventHub } from '../modules/progress/event-hub.ts';
import type { PgBoss } from '../queue/boss.ts';
import type { Logger } from '../shared/logger.ts';

/** Everything the public HTTP app needs. Built by bin/api.ts (or a test) from CoreDeps. */
export interface ApiDeps extends CoreDeps {
  github: GitHubPort;
  guard: GuardPort;
  /** A sender-only pg-boss: no supervision, no cron, no DDL. */
  boss: PgBoss;
  events: EventHub;
  log: Logger;
}
