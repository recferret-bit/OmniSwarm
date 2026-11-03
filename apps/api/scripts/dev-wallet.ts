// A development wallet: an ed25519 key (random, or derived from a seed for reproducible vectors) that
// builds the canonical request message and signs it the way a NEP-413 wallet does (base64 signature).
// Used by scripts/sign-request.ts and the tests; never by src/.
import crypto from 'node:crypto';
import { canonicalRequestMessage, type RequestMessageFields } from '@omniswarm/schemas/canonical-message';
import { encodePublicKey, rawPublicKey, signNep413 } from '../src/modules/auth/nep413.ts';

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface SignedBody { accountId: string; publicKey: string; signature: string; message: string; nonce: string }

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

  /** Sign an arbitrary message string (tests use this to sign non-canonical messages). */
  signMessage(message: string, nonce: string, recipient: string): SignedBody {
    const signature = signNep413(this.#key, message, Buffer.from(nonce, 'base64'), recipient);
    return { accountId: this.accountId, publicKey: this.publicKey, signature, message, nonce };
  }

  signRequest(fields: Omit<RequestMessageFields, 'account'> & { account?: string }, recipient: string): SignedBody {
    const message = canonicalRequestMessage({ ...fields, account: fields.account ?? this.accountId });
    return this.signMessage(message, fields.nonce, recipient);
  }
}
