// `npm start -w @omniswarm/api`: the public HTTP API on HOST:PORT and, when ADMIN_TOKEN is set, the
// admin listener on ADMIN_HOST:ADMIN_PORT. Stateless: run as many replicas as needed behind nginx.
import { createCore, createGitHub, createGuardPort } from '../container.ts';
import { buildAdminApp, buildApp } from '../http/app.ts';
import { EventHub } from '../modules/progress/event-hub.ts';
import { createBoss } from '../queue/boss.ts';
import { configOrExit, onShutdown } from '../shared/lifecycle.ts';
import { createLogger } from '../shared/logger.ts';

const config = configOrExit('api');
const log = createLogger(config.logLevel, 'omniswarm-api');
const core = await createCore(config);
const boss = createBoss(config, 'sender');
boss.on('error', (error) => log.error({ err: error }, 'pg-boss error'));
await boss.start();
const events = new EventHub(config.db.url, log);
await events.start();
const app = await buildApp({ ...core, github: await createGitHub(config), guard: await createGuardPort(config, core.chain), boss, events, log });
await app.listen({ host: config.http.host, port: config.http.port });

const admin = config.admin.token ? await buildAdminApp({ ...core, log }, config.admin.token) : null;
if (admin) await admin.listen({ host: config.admin.host, port: config.admin.port });
else log.warn('ADMIN_TOKEN is not set: the admin listener is disabled');

onShutdown(log, async () => {
  await Promise.all([app.close(), admin?.close()]);
  await boss.stop({ graceful: true, timeout: 10_000 });
  await events.close();
  await core.chain.close();
  await core.pool.end();
}, 30_000);
