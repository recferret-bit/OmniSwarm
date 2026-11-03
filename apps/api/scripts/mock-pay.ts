import crypto from 'node:crypto';
import { b58encode } from '../src/lib.ts';
import { createPool, getRequest, migrate, putMockPayment } from '../src/store.ts';

function arg(name: string, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

const databaseUrl = process.env.DATABASE_URL || arg('database-url');
const requestId = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : arg('request');
if (!databaseUrl || !requestId) {
  console.error('usage: mock-pay.ts <requestId> [--amount yocto]');
  process.exit(1);
}
const pool = createPool(databaseUrl);
await migrate(pool);
const row = await getRequest(pool, requestId);
if (!row) {
  console.error('request not found');
  process.exit(1);
}
const amount = arg('amount', row.price_yocto);
const txHash = b58encode(crypto.randomBytes(32)).slice(0, 44);
await putMockPayment(pool, {
  txHash,
  requestHash: row.request_hash,
  account: row.account,
  receiver: process.env.CONTRACT_ID || 'review-registry.mock',
  amount,
});
await pool.end();
process.stdout.write(`${JSON.stringify({ txHash, requestHash: row.request_hash, amount })}\n`);
