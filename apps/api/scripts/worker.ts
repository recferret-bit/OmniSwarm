// One worker process. On startup it finishes requests left `running` by a
// killed worker, then claims queued requests. Each review is `./bin/audit`.
import { createPool, migrate } from '../src/store.ts';
import { drainOne, recoverInFlight, REPO_ROOT } from '../src/worker.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}
const pool = createPool(databaseUrl);
await migrate(pool);
const reportsRoot = process.env.REPORTS_ROOT || `${REPO_ROOT}/reports/worker`;
const engineRoot = process.env.ENGINE_ROOT || REPO_ROOT;
const opts = { reportsRoot, engineRoot, mode: 'ok' as const };
let ran = 0;
for (const job of await recoverInFlight(pool, opts)) {
  ran += 1;
  console.log(`${job.id} ${job.status}`);
}
for (;;) {
  const job = await drainOne(pool, opts);
  if (!job) break;
  ran += 1;
  console.log(`${job.id} ${job.status}`);
}
await pool.end();
console.log(`worker finished ${ran}`);
