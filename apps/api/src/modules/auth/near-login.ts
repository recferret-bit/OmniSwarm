// Wallet sign-in. The client already connected and signed; the login message is rebuilt here.
// A client-supplied message is not accepted.
import type { ChainPort } from '../../chain/port.ts';
import type { Network } from '../../config/load.ts';
import type { Db } from '../../db/pool.ts';
import { consumeNonce, type NonceState } from '../../db/repositories/nonces.ts';
import { fail } from '../../shared/errors.ts';
import { decodePublicKey, decodeSignature, verifyNep413 } from './nep413.ts';

export interface NearLoginBody {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string;
}

export interface NearLoginDeps {
  config: { intake: { network: Network; recipient: string } };
  chain: Pick<ChainPort, 'kind' | 'keyPermission'>;
  db: Db;
  now: Date;
}

export interface NearSession {
  account: string;
  label: string;
  provider: 'near';
}

/** Exact login payload: this key order, no spaces. The nonce is the challenge string. */
export function loginMessage(accountId: string, nonce: string): string {
  return JSON.stringify({ account: accountId, kind: 'login', nonce, v: 1 });
}

function refuseNonce(state: NonceState): void {
  if (state === 'used') fail('NONCE_USED', 'This challenge was already used');
  if (state === 'expired') fail('NONCE_EXPIRED', 'This challenge has expired');
  if (state === 'missing') fail('NONCE_UNKNOWN', 'Unknown challenge; request one from /api/challenge');
}

export async function loginNear(deps: NearLoginDeps, body: NearLoginBody): Promise<NearSession> {
  const message = loginMessage(body.accountId, body.nonce);
  const key = decodePublicKey(body.publicKey);
  const signature = decodeSignature(body.signature);
  const nonce = Buffer.from(body.nonce, 'base64');
  if (!key || !signature || nonce.length !== 32 || !verifyNep413(key, signature, message, nonce, deps.config.intake.recipient)) {
    fail('SIG_INVALID', 'The signature does not match the message');
  }
  const network = deps.config.intake.network;
  // Testnet wallets do not exist on the sandbox RPC.
  if ((network === 'testnet' || network === 'mainnet') && deps.chain.kind !== 'mock') {
    const permission = await deps.chain.keyPermission(body.accountId, body.publicKey);
    if (permission !== 'FullAccess') fail('KEY_NOT_FULL_ACCESS', 'The signing key is not a full-access key of this account');
  }
  refuseNonce(await consumeNonce(deps.db, body.nonce, deps.now));
  return { account: body.accountId, label: body.accountId, provider: 'near' };
}
