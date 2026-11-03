// One worker process. It claims queued requests and spawns ./bin/audit for each.
import { createPool, migrate } from '../src/store.ts';
import { drainOne, REPO_ROOT } from '../src/worker.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}
const pool = createPool(databaseUrl);
await migrate(pool);
const reportsRoot = process.env.REPORTS_ROOT || `${REPO_ROOT}/reports/worker`;
let ran = 0;
for (;;) {
  const job = await drainOne(pool, { reportsRoot, engineRoot: process.env.ENGINE_ROOT || REPO_ROOT, mode: 'ok' });
  if (!job) break;
  ran += 1;
  console.log(`${job.id} ${job.status}`);
}
await pool.end();
console.log(`worker finished ${ran}`);
