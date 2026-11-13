// `npm start -w @omniswarm/api`: the public HTTP API on HOST:PORT. Stateless: run as many replicas as needed behind nginx.
import { createCore, createGitHub, createKeyVerifier } from '../container.ts';
import { buildApp } from '../http/app.ts';
import { EventHub } from '../modules/progress/event-hub.ts';
import { createBoss } from '../queue/boss.ts';
import { configOrExit, onShutdown } from '../shared/lifecycle.ts';
import { createLogger } from '../shared/logger.ts';

const config = configOrExit('api');
const log = createLogger(config.logLevel, 'omniswarm-api');
const core = createCore(config);
const boss = createBoss(config, 'sender');
boss.on('error', (error) => log.error({ err: error }, 'pg-boss error'));
await boss.start();
const events = new EventHub(config.db.url, log);
await events.start();
const app = await buildApp({ ...core, github: await createGitHub(config), keys: await createKeyVerifier(config), boss, events, log });
await app.listen({ host: config.http.host, port: config.http.port });

onShutdown(log, async () => {
  await app.close();
  await boss.stop({ graceful: true, timeout: 10_000 });
  await events.close();
  await core.pool.end();
}, 30_000);
