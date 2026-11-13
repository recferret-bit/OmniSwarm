import { verifyMessage } from 'near-api-js/nep413';
import { describe, expect, it } from 'vitest';
import { createMockConnector, MOCK_ACCOUNT } from '@/mocks/wallet';
import { nearLoginMessage } from '@/lib/auth/near-login';
import { base64ToBytes, bytesToBase64, decodeChallengeNonce } from './nep413';

const NONCE = bytesToBase64(new Uint8Array(32).fill(7));

describe('nep413 client helpers', () => {
  it('decodes only a 32-byte challenge nonce', () => {
    expect(decodeChallengeNonce(NONCE)).toHaveLength(32);
    expect(() => decodeChallengeNonce(bytesToBase64(new Uint8Array(16)))).toThrow(/32 bytes/);
  });

  it('builds the login message with sorted keys', () => {
    expect(nearLoginMessage('alice.near', NONCE)).toBe(JSON.stringify({ account: 'alice.near', kind: 'login', nonce: NONCE, v: 1 }));
  });

  it('mock wallet signatures are base64 NEP-413 signatures that near-api-js verifyMessage accepts', async () => {
    const wallet = createMockConnector();
    const message = nearLoginMessage(MOCK_ACCOUNT, NONCE);
    const nonce = decodeChallengeNonce(NONCE);
    const signed = await wallet.signMessage({ message, recipient: 'omniswarm.near', nonce });
    expect(signed.publicKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(signed.signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    const provider = { viewAccessKey: async () => ({ permission: 'FullAccess' }) } as unknown as Parameters<typeof verifyMessage>[0]['provider'];
    const payload = { message, recipient: 'omniswarm.near', nonce };
    await expect(verifyMessage({ signerAccountId: MOCK_ACCOUNT, signerPublicKey: signed.publicKey, payload, signature: base64ToBytes(signed.signature), provider })).resolves.toBeUndefined();
    const other = { ...payload, recipient: 'attacker.near' };
    await expect(verifyMessage({ signerAccountId: MOCK_ACCOUNT, signerPublicKey: signed.publicKey, payload: other, signature: base64ToBytes(signed.signature), provider })).rejects.toThrow();
  });
});
