// `npm run openapi -w @omniswarm/api [-- --check]` (W08-20): write apps/api/openapi.json from the route
// schemas, or fail when the committed file is out of date. Builds the app without connecting anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config/load.ts';
import { createPool } from '../src/db/pool.ts';
import { buildApp } from '../src/http/app.ts';
import type { ApiDeps } from '../src/http/deps.ts';
import { createBoss } from '../src/queue/boss.ts';
import { systemClock } from '../src/shared/clock.ts';
import { createLogger } from '../src/shared/logger.ts';
import { APP_ROOT } from '../src/shared/paths.ts';

const env = { DATABASE_URL: 'postgres://openapi@127.0.0.1:1/none', SESSION_SECRET: 'o'.repeat(32), NODE_ENV: 'test' };
const config = loadConfig('api', env);
const unused = new Proxy({}, { get: () => { throw new Error('openapi generation does not call adapters'); } });
const deps = {
  config, pool: createPool(config.db.url, 1), clock: systemClock, keys: unused, github: unused,
  boss: createBoss(config, 'sender'), events: unused, log: createLogger('silent', 'openapi'),
} as unknown as ApiDeps;
const app = await buildApp(deps);
await app.ready();
const spec = `${JSON.stringify(app.swagger(), null, 2)}\n`;
await app.close();
await deps.pool.end();
const file = path.join(APP_ROOT, 'openapi.json');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== spec) {
    process.stderr.write('apps/api/openapi.json is out of date; run npm run openapi -w @omniswarm/api\n');
    process.exit(1);
  }
  process.stdout.write('openapi.json is up to date\n');
} else {
  fs.writeFileSync(file, spec);
  process.stdout.write(`wrote ${file}\n`);
}
