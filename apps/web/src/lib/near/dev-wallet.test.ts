import crypto from 'node:crypto';
import { KeyPair, baseEncode } from 'near-api-js';
import { describe, expect, it } from 'vitest';
import { b58decode, nep413Payload } from '@omniswarm/schemas/nep413';
import { createDevWallet, type DevAccount } from './dev-wallet';

const PRICE = '1000000000000000000000000';

function freshAccount(accountId: string): DevAccount {
  const key = KeyPair.fromRandom('ed25519');
  return { accountId, publicKey: key.getPublicKey().toString(), secretKey: key.toString() };
}

// packages/schemas/nep413.mjs builds the payload. Verification is sha256(payload), then ed25519.
function verifyNep413(publicKey: string, signature: string, message: string, nonce: Uint8Array, recipient: string): boolean {
  const raw = Buffer.from(b58decode(publicKey.replace(/^ed25519:/, '')));
  const key = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
    format: 'der',
    type: 'spki',
  });
  const digest = crypto.createHash('sha256').update(nep413Payload(message, nonce, recipient)).digest();
  return crypto.verify(null, digest, key, Buffer.from(signature, 'base64'));
}

describe('dev wallet', () => {
  it('dev wallet NEP-413 signature verifies', async () => {
    const alice = freshAccount('alice.test.near');
    const bob = freshAccount('bob.test.near');
    let requested = '';
    const fetchAccounts: typeof fetch = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ accounts: [alice, bob] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const wallet = createDevWallet({ fetch: fetchAccounts, accountId: alice.accountId });
    await expect(wallet.listAccounts()).resolves.toEqual([
      { accountId: alice.accountId, publicKey: alice.publicKey },
      { accountId: bob.accountId, publicKey: bob.publicKey },
    ]);
    expect(requested).toBe('http://127.0.0.1:3031/wallet/accounts');

    const indexerShape = {
      accounts: [{ account_id: alice.accountId, public_key: alice.publicKey, private_key: alice.secretKey }],
    };
    const fromIndexer = createDevWallet({
      fetch: async () => new Response(JSON.stringify(indexerShape), { status: 200 }),
      accountId: alice.accountId,
    });
    await expect(fromIndexer.listAccounts()).resolves.toEqual([{ accountId: alice.accountId, publicKey: alice.publicKey }]);

    const message = '{"account":"alice.test.near","v":1}';
    const nonce = new Uint8Array(32).fill(9);
    const recipient = 'omniswarm.test.near';
    const signed = await wallet.signMessage({ message, recipient, nonce });
    expect(signed.accountId).toBe(alice.accountId);
    expect(signed.publicKey).toBe(alice.publicKey);
    expect(verifyNep413(signed.publicKey, signed.signature, message, nonce, recipient)).toBe(true);
    expect(verifyNep413(signed.publicKey, signed.signature, message, nonce, 'attacker.test.near')).toBe(false);
  });

  it('request_review built against a stub RPC has receiver registry.test.near and deposit = price', async () => {
    const alice = freshAccount('alice.test.near');
    const seen: Array<{ receiverId: string; signerId: string; methodName?: string; deposit?: bigint }> = [];
    const rpc = {
      async viewAccessKey() {
        return { nonce: 1n, permission: 'FullAccess' };
      },
      async viewBlock() {
        return { header: { hash: baseEncode(new Uint8Array(32).fill(7)) } };
      },
      async sendTransactionUntil(signedTransaction: unknown) {
        const tx = (signedTransaction as { transaction: { receiverId: string; signerId: string; actions: Array<{ functionCall?: { methodName: string; deposit: bigint } }> } }).transaction;
        const call = tx.actions[0]?.functionCall;
        seen.push({ receiverId: tx.receiverId, signerId: tx.signerId, methodName: call?.methodName, deposit: call?.deposit });
        return { status: { SuccessValue: '' }, transaction: { hash: 'stub-tx' }, transaction_outcome: { id: 'stub-tx' } };
      },
    };
    const wallet = createDevWallet({
      accounts: () => ({ accounts: [alice] }),
      rpc,
      accountId: alice.accountId,
    });
    await expect(wallet.signAndSendTransaction({
      receiverId: 'registry.test.near',
      actions: [{
        type: 'FunctionCall',
        params: { methodName: 'request_review', args: { request_hash: 'ab'.repeat(32) }, gas: '30000000000000', deposit: PRICE },
      }],
    })).resolves.toEqual({ txHash: 'stub-tx' });
    expect(seen).toEqual([{ receiverId: 'registry.test.near', signerId: alice.accountId, methodName: 'request_review', deposit: BigInt(PRICE) }]);
  });
});
