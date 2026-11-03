import { verifyMessage } from 'near-api-js/nep413';
import { describe, expect, it } from 'vitest';
import vectors from '../../../../../packages/schemas/canonical-message.vectors.json';
import { createMockConnector, MOCK_ACCOUNT } from '@/mocks/wallet';
import { base64ToBytes, buildSignedRequest, bytesToBase64, decodeChallengeNonce } from './nep413';

const NONCE = bytesToBase64(new Uint8Array(32).fill(7));

describe('nep413 client helpers', () => {
  it('builds the shared canonical message and hash byte for byte', async () => {
    for (const vector of vectors.vectors) {
      const input = vector.input as Parameters<typeof buildSignedRequest>[0];
      const built = await buildSignedRequest(input);
      expect(built.message).toBe(vector.message);
      expect(built.requestHash).toBe(vector.hash);
    }
  });

  it('decodes only a 32-byte challenge nonce', () => {
    expect(decodeChallengeNonce(NONCE)).toHaveLength(32);
    expect(() => decodeChallengeNonce(bytesToBase64(new Uint8Array(16)))).toThrow(/32 bytes/);
  });

  it('mock wallet signatures are base64 NEP-413 signatures that near-api-js verifyMessage accepts', async () => {
    const wallet = createMockConnector();
    const built = await buildSignedRequest({
      account: MOCK_ACCOUNT, commit: 'a'.repeat(40), deployed: null, network: 'testnet', nonce: NONCE, preset: 'scripted', repo: 'near/near-sdk-rs',
    });
    const signed = await wallet.signMessage({ message: built.message, recipient: 'omniswarm.testnet', nonce: built.nonceBytes });
    expect(signed.publicKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(signed.signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    const provider = { viewAccessKey: async () => ({ permission: 'FullAccess' }) } as unknown as Parameters<typeof verifyMessage>[0]['provider'];
    const payload = { message: built.message, recipient: 'omniswarm.testnet', nonce: built.nonceBytes };
    await expect(verifyMessage({ signerAccountId: MOCK_ACCOUNT, signerPublicKey: signed.publicKey, payload, signature: base64ToBytes(signed.signature), provider })).resolves.toBeUndefined();
    const other = { ...payload, recipient: 'attacker.testnet' };
    await expect(verifyMessage({ signerAccountId: MOCK_ACCOUNT, signerPublicKey: signed.publicKey, payload: other, signature: base64ToBytes(signed.signature), provider })).rejects.toThrow();
  });
});
