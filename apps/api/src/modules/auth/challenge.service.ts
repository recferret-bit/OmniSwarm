import crypto from 'node:crypto';
import type { Db } from '../../db/pool.ts';
import { audit } from '../../db/repositories/audit.ts';
import { issueNonce } from '../../db/repositories/nonces.ts';
import { iso, type Clock } from '../../shared/clock.ts';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** 32 random bytes (base64, 44 chars) the wallet must sign within five minutes, once. */
export async function issueChallenge(deps: { db: Db; clock: Clock }, ip: string): Promise<{ nonce: string; expiresAt: string }> {
  const now = deps.clock.now();
  const nonce = crypto.randomBytes(32).toString('base64');
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  await issueNonce(deps.db, nonce, now, expiresAt, ip);
  await audit(deps.db, { actor: 'api', requestId: null, event: 'challenge_issued', data: { ip }, now });
  return { nonce, expiresAt: iso(expiresAt) };
}
