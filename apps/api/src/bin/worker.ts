// `npm run worker -w @omniswarm/api`: a long-running review worker. Start as many processes as the
// host allows; each takes up to WORKER_CONCURRENCY jobs at once. SIGTERM stops taking jobs and waits
// for running reviews to stop: their engines get SIGTERM at once (SIGKILL after ENGINE_KILL_GRACE_S) and the
// jobs are retried by another worker. Exits well within systemd's TimeoutStopSec=180.
import { createCore, createEngine } from '../container.ts';
import { createBoss } from '../queue/boss.ts';
import { configOrExit, onShutdown } from '../shared/lifecycle.ts';
import { createLogger } from '../shared/logger.ts';
import { startWorker } from '../worker/worker.ts';

const config = configOrExit('worker');
const log = createLogger(config.logLevel, 'omniswarm-worker');
const core = await createCore(config, undefined, { operator: true });
const engine = await createEngine(config);
const boss = createBoss(config, 'worker');
boss.on('error', (error) => log.error({ err: error }, 'pg-boss error'));
await boss.start();
const shutdown = new AbortController();
await startWorker(boss, { ...core, engine, boss, log: config.queue.workerId ? log.child({ workerId: config.queue.workerId }) : log }, shutdown.signal);
log.info({ concurrency: config.queue.concurrency, engine: engine.kind, chain: core.chain.kind }, 'worker ready');

onShutdown(log, async () => {
  // Forward SIGTERM to running engines now; their jobs fail and are retried by another worker.
  shutdown.abort();
  await boss.stop({ graceful: true, timeout: config.queue.stopTimeoutS * 1000 });
  await core.chain.close();
  await core.pool.end();
}, (config.queue.stopTimeoutS + 30) * 1000);
