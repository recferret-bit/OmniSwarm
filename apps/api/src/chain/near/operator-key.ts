// Loads the operator's function-call key from OPERATOR_KEY_FILE (a systemd credential, worker only).
// The key is held only inside a near-api-js KeyPairSigner and is never logged or returned.
import fs from 'node:fs';
import { KeyPairSigner, type KeyPairString } from 'near-api-js';

const KEY = /^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{43,128}$/;

export interface OperatorKey { accountId: string | null; signer: KeyPairSigner }

/** The signer, plus the account id when the file is near-cli credentials JSON. */
export function loadOperatorKey(keyPath: string): OperatorKey {
  const stat = fs.statSync(keyPath);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`operator key file ${keyPath} must not be readable by group or others (chmod 600)`);
  }
  const text = fs.readFileSync(keyPath, 'utf8').trim();
  // Either a bare `ed25519:<base58>` secret or near-cli's credentials JSON.
  let secret = text;
  let accountId: string | null = null;
  if (text.startsWith('{')) {
    const parsed = JSON.parse(text) as { account_id?: string; private_key?: string; secret_key?: string };
    secret = parsed.private_key ?? parsed.secret_key ?? '';
    accountId = typeof parsed.account_id === 'string' ? parsed.account_id : null;
  }
  if (!KEY.test(secret)) throw new Error(`operator key file ${keyPath} does not hold an ed25519:/secp256k1: secret key`);
  return { accountId, signer: KeyPairSigner.fromSecretKey(secret as KeyPairString) };
}
