import { createPool, migrate } from './store.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}
const pool = createPool(databaseUrl);
await migrate(pool);
await pool.end();
console.log('migrated');
