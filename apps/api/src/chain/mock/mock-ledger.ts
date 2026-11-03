// The user's side of the mock chain: what a wallet would put on chain (keys, a payable
// `request_review`). Used by the dev scripts (sign-request, mock-pay) and tests only.
import type { Db } from '../../db/pool.ts';
import type { KeyPermission } from '../port.ts';
import { mockTxHash } from './mock-chain.ts';

export async function registerKey(db: Db, account: string, publicKey: string, permission: KeyPermission): Promise<void> {
  await db.query(
    `INSERT INTO mock_chain_key (account, public_key, permission) VALUES ($1, $2, $3)
     ON CONFLICT (account, public_key) DO UPDATE SET permission = EXCLUDED.permission`,
    [account, publicKey, permission]);
}

export async function setCodeHash(db: Db, account: string, codeHash: string): Promise<void> {
  await db.query(
    `INSERT INTO mock_chain_account (account, code_hash) VALUES ($1, $2)
     ON CONFLICT (account) DO UPDATE SET code_hash = EXCLUDED.code_hash`, [account, codeHash]);
}

/**
 * Simulate `request_review(request_hash)` with an attached deposit, signed by `signer`. Like the
 * contract, a hash that is already registered makes the tx fail. Returns the tx hash.
 */
export async function payRequestReview(db: Db, input: {
  signer: string; receiver: string; requestHash: string; depositYocto: string; seed?: string;
}): Promise<string> {
  const txHash = mockTxHash(`request_review:${input.requestHash}:${input.signer}:${input.depositYocto}:${input.seed ?? ''}`);
  const inserted = await db.query(
    `INSERT INTO mock_chain_request (request_hash, account, deposit, status, block_height)
     VALUES ($1, $2, $3, 'Pending', (SELECT count(*) + 1 FROM mock_chain_tx)) ON CONFLICT (request_hash) DO NOTHING`,
    [input.requestHash, input.signer, input.depositYocto]);
  const success = inserted.rowCount === 1;
  await db.query(
    `INSERT INTO mock_chain_tx (tx_hash, signer, receiver, method, args, deposit, success)
     VALUES ($1, $2, $3, 'request_review', $4, $5, $6) ON CONFLICT (tx_hash) DO NOTHING`,
    [txHash, input.signer, input.receiver, JSON.stringify({ request_hash: input.requestHash }), input.depositYocto, success]);
  if (success) {
    await db.query(`INSERT INTO mock_chain_event (event, request_hash, data) VALUES ('review_requested', $1, $2)`,
      [input.requestHash, JSON.stringify({ account: input.signer, deposit: input.depositYocto })]);
  }
  return txHash;
}

export async function chainEvents(db: Db, requestHash: string): Promise<string[]> {
  const result = await db.query<{ event: string }>('SELECT event FROM mock_chain_event WHERE request_hash = $1 ORDER BY id', [requestHash]);
  return result.rows.map((row) => row.event);
}
