// `npm run db:reset -w @omniswarm/api` (W08-22): drop and recreate the database DATABASE_URL names
// (the per-worktree one from tools/worktree-env.mjs). Development only; run db:migrate afterwards.
import pg from 'pg';
import { databaseUrl, devOnly } from './cli.ts';

devOnly('db-reset');
const url = new URL(databaseUrl());
const name = url.pathname.slice(1);
if (!/^[a-z0-9_]{1,63}$/.test(name) || name === 'postgres') {
  process.stderr.write(`refusing to reset database ${JSON.stringify(name)}\n`);
  process.exit(2);
}
url.pathname = '/postgres';
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  process.stdout.write(`database ${name} recreated; run npm run db:migrate -w @omniswarm/api\n`);
} finally {
  await admin.end();
}
