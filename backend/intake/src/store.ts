import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

export function createPool(databaseUrl: string) {
  return new Pool({ connectionString: databaseUrl });
}

export async function migrate(pool: pg.Pool) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '001_init.sql');
  await pool.query(fs.readFileSync(file, 'utf8'));
}

export async function reset(pool: pg.Pool) {
  await pool.query(`TRUNCATE nonce, payment, request_progress, audit_log, job_stub, mock_key, mock_request, mock_tx, request RESTART IDENTITY CASCADE`);
}

export async function issueNonce(pool: pg.Pool, nonce: string, now: Date, expires: Date, ip: string) {
  await pool.query('INSERT INTO nonce (nonce, created_at, expires_at, ip) VALUES ($1, $2, $3, $4)', [nonce, now.toISOString(), expires.toISOString(), ip]);
}

export async function consumeNonce(pool: pg.Pool, nonce: string, now: Date): Promise<'ok' | 'missing' | 'used' | 'expired'> {
  const found = await pool.query('SELECT expires_at, used_at FROM nonce WHERE nonce = $1', [nonce]);
  if (!found.rowCount) return 'missing';
  if (found.rows[0].used_at) return 'used';
  if (new Date(found.rows[0].expires_at).getTime() <= now.getTime()) return 'expired';
  const updated = await pool.query('UPDATE nonce SET used_at = $2 WHERE nonce = $1 AND used_at IS NULL RETURNING nonce', [nonce, now.toISOString()]);
  return updated.rowCount ? 'ok' : 'used';
}

export async function queueDepth(pool: pg.Pool): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS n FROM request WHERE status IN ('queued', 'running')`);
  return result.rows[0].n;
}

export async function insertRequest(pool: pg.Pool, row: {
  id: string; account: string; repo: string; commitSha: string; network: string; preset: string;
  requestHash: string; priceYocto: string; now: Date;
}) {
  await pool.query(
    `INSERT INTO request (id, account, repo, commit_sha, network, preset, deployed, request_hash, price_yocto, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,'awaiting_payment',$9,$9)`,
    [row.id, row.account, row.repo, row.commitSha, row.network, row.preset, row.requestHash, row.priceYocto, row.now.toISOString()],
  );
  await audit(pool, 'api', row.id, 'request_created', { repo: row.repo }, row.now);
}

export async function audit(pool: pg.Pool, actor: string, requestId: string | null, event: string, data: unknown, now: Date) {
  await pool.query(
    'INSERT INTO audit_log (ts, actor, request_id, event, data) VALUES ($1, $2, $3, $4, $5)',
    [now.toISOString(), actor, requestId, event, JSON.stringify(data)],
  );
}

export async function getRequest(pool: pg.Pool, id: string) {
  const result = await pool.query('SELECT * FROM request WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function listMine(pool: pg.Pool, account: string) {
  const result = await pool.query(
    'SELECT id, repo, status, created_at FROM request WHERE account = $1 ORDER BY created_at',
    [account],
  );
  return result.rows;
}

export async function markQueued(pool: pg.Pool, requestId: string, txHash: string, amount: string, signer: string, now: Date) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT request_id FROM payment WHERE tx_hash = $1', [txHash]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return 'used' as const;
    }
    const updated = await client.query(
      `UPDATE request SET status = 'queued', updated_at = $2 WHERE id = $1 AND status = 'awaiting_payment' RETURNING request_hash`,
      [requestId, now.toISOString()],
    );
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      return 'missing' as const;
    }
    await client.query(
      'INSERT INTO payment (tx_hash, request_id, amount_yocto, signer, verified_at) VALUES ($1, $2, $3, $4, $5)',
      [txHash, requestId, amount, signer, now.toISOString()],
    );
    await client.query('INSERT INTO job_stub (request_id, request_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING', [requestId, updated.rows[0].request_hash]);
    await client.query(
      'INSERT INTO audit_log (ts, actor, request_id, event, data) VALUES ($1, $2, $3, $4, $5)',
      [now.toISOString(), 'api', requestId, 'payment_verified', JSON.stringify({ txHash })],
    );
    const position = await client.query(`SELECT count(*)::int AS n FROM request WHERE status = 'queued'`);
    await client.query('COMMIT');
    return { position: position.rows[0].n as number };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function awaitingPayment(pool: pg.Pool) {
  const result = await pool.query(`SELECT * FROM request WHERE status = 'awaiting_payment'`);
  return result.rows;
}

export async function putKey(pool: pg.Pool, account: string, publicKey: string, permission: 'FullAccess' | 'FunctionCall') {
  await pool.query(
    `INSERT INTO mock_key (account, public_key, permission) VALUES ($1, $2, $3)
     ON CONFLICT (public_key) DO UPDATE SET account = EXCLUDED.account, permission = EXCLUDED.permission`,
    [account, publicKey, permission],
  );
}

export async function keyPermission(pool: pg.Pool, account: string, publicKey: string): Promise<string | null> {
  const result = await pool.query('SELECT permission FROM mock_key WHERE account = $1 AND public_key = $2', [account, publicKey]);
  return result.rows[0]?.permission || null;
}

export async function putMockPayment(pool: pg.Pool, row: {
  txHash: string; requestHash: string; account: string; receiver: string; amount: string; success?: boolean;
}) {
  await pool.query(
    `INSERT INTO mock_request (request_hash, account, deposit, status) VALUES ($1, $2, $3, 'Pending')
     ON CONFLICT (request_hash) DO UPDATE SET deposit = EXCLUDED.deposit, status = 'Pending', account = EXCLUDED.account`,
    [row.requestHash, row.account, row.amount],
  );
  await pool.query(
    `INSERT INTO mock_tx (tx_hash, request_hash, signer, receiver, amount_yocto, success) VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.txHash, row.requestHash, row.account, row.receiver, row.amount, row.success !== false],
  );
}

export async function paymentExists(pool: pg.Pool, txHash: string) {
  const result = await pool.query('SELECT 1 FROM payment WHERE tx_hash = $1', [txHash]);
  return Boolean(result.rowCount);
}

export async function mockTx(pool: pg.Pool, txHash: string) {
  const result = await pool.query('SELECT * FROM mock_tx WHERE tx_hash = $1', [txHash]);
  return result.rows[0] || null;
}

export async function mockRequest(pool: pg.Pool, requestHash: string) {
  const result = await pool.query('SELECT * FROM mock_request WHERE request_hash = $1', [requestHash]);
  return result.rows[0] || null;
}
