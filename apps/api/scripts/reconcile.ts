import { reconcile } from '../src/app.ts';
import { createPool, migrate } from '../src/store.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}
const pool = createPool(databaseUrl);
await migrate(pool);
const moved = await reconcile(pool);
await pool.end();
process.stdout.write(`${JSON.stringify({ queued: moved })}\n`);
