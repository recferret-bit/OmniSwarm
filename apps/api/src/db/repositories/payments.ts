import type { Db } from '../pool.ts';

export interface PaymentRow { tx_hash: string; request_id: string; amount_yocto: string; signer: string; verified_at: Date }

export async function insertPayment(db: Db, row: { txHash: string; requestId: string; amountYocto: string; signer: string; now: Date }): Promise<void> {
  await db.query('INSERT INTO payment (tx_hash, request_id, amount_yocto, signer, verified_at) VALUES ($1, $2, $3, $4, $5)',
    [row.txHash, row.requestId, row.amountYocto, row.signer, row.now]);
}

export async function findPayment(db: Db, txHash: string): Promise<PaymentRow | null> {
  const result = await db.query<PaymentRow>('SELECT * FROM payment WHERE tx_hash = $1', [txHash]);
  return result.rows[0] ?? null;
}
