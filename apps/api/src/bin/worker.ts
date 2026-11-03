// `npm run worker -w @omniswarm/api`: a long-running review worker. Start as many processes as the
// host allows; each takes up to WORKER_CONCURRENCY jobs at once. SIGTERM stops taking jobs and waits
// up to WORKER_STOP_TIMEOUT_S for running reviews before aborting them (they are retried elsewhere).
import { createCore, createEngine } from '../container.ts';
import { createBoss } from '../queue/boss.ts';
import { configOrExit, onShutdown } from '../shared/lifecycle.ts';
import { createLogger } from '../shared/logger.ts';
import { startWorker } from '../worker/worker.ts';

const config = configOrExit('worker');
const log = createLogger(config.logLevel, 'omniswarm-worker');
const core = await createCore(config);
const engine = await createEngine(config);
const boss = createBoss(config, 'worker');
boss.on('error', (error) => log.error({ err: error }, 'pg-boss error'));
await boss.start();
await startWorker(boss, { ...core, engine, boss, log });
log.info({ concurrency: config.queue.concurrency, engine: engine.kind, chain: core.chain.kind }, 'worker ready');

onShutdown(log, async () => {
  await boss.stop({ graceful: true, timeout: config.queue.stopTimeoutS * 1000 });
  await core.chain.close();
  await core.pool.end();
}, (config.queue.stopTimeoutS + 30) * 1000);
