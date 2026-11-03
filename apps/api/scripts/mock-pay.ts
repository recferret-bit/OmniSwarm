// Dev script (W08 demo step 6): put the requester's payable `request_review` on the MOCK chain and
// print its tx hash. `node apps/api/scripts/mock-pay.ts <requestId> [--amount yocto] [--signer acct]`
import { payRequestReview } from '../src/chain/mock/mock-ledger.ts';
import { createPool } from '../src/db/pool.ts';
import { findRequest } from '../src/db/repositories/requests.ts';
import { databaseUrl, devOnly, flags } from './cli.ts';

devOnly('mock-pay');
const { values, positionals } = flags({ amount: { type: 'string' }, signer: { type: 'string' } }, 'mock-pay.ts <requestId> [--amount yocto] [--signer account]');
const pool = createPool(databaseUrl(), 1);
try {
  const row = positionals[0] ? await findRequest(pool, positionals[0]) : null;
  if (!row) {
    process.stderr.write('request not found\n');
    process.exit(1);
  }
  const amount = values.amount ?? row.price_yocto;
  const txHash = await payRequestReview(pool, {
    signer: values.signer ?? row.account, receiver: process.env.CONTRACT_ID ?? 'review-registry.mock', requestHash: row.request_hash, depositYocto: amount,
  });
  process.stdout.write(`${JSON.stringify({ txHash, requestHash: row.request_hash, amount })}\n`);
} finally {
  await pool.end();
}
