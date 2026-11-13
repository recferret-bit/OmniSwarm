// A development NEAR wallet: an ed25519 key (random, or derived from a seed for reproducible vectors) that
// signs the sign-in message the way a NEP-413 wallet does (base64 signature). Used by the tests; never by src/.
// It needs no chain: with KEY_VERIFIER=mock any key is a full-access key unless a test pins it.
import crypto from 'node:crypto';
import { encodePublicKey, rawPublicKey, signNep413 } from '../src/modules/auth/nep413.ts';
import { loginMessage } from '../src/modules/auth/near-login.ts';

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface NearLoginBody { accountId: string; publicKey: string; signature: string; nonce: string }

export class DevWallet {
  readonly accountId: string;
  readonly publicKey: string;
  readonly #key: crypto.KeyObject;

  constructor(accountId: string, seed?: string) {
    this.accountId = accountId;
    this.#key = seed
      ? crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, crypto.createHash('sha256').update(seed).digest()]), format: 'der', type: 'pkcs8' })
      : crypto.generateKeyPairSync('ed25519').privateKey;
    this.publicKey = encodePublicKey(rawPublicKey(crypto.createPublicKey(this.#key)));
  }

  /** The body of POST /api/login/near for `nonce` (from POST /api/challenge). */
  login(nonce: string, recipient: string): NearLoginBody {
    const signature = signNep413(this.#key, loginMessage(this.accountId, nonce), Buffer.from(nonce, 'base64'), recipient);
    return { accountId: this.accountId, publicKey: this.publicKey, signature, nonce };
  }
}
