// Sign-in only. near-connect cannot reach the local sandbox, so this is always
// testnet. Payments keep using getConnector() (the dev wallet when NEXT_PUBLIC_WALLET=local).
import { api, type SessionAccount } from '@/lib/api/client';
import { AppError } from '@/lib/api/errors';
import { env } from '@/lib/env';
import { normalizeWalletError } from '@/lib/near/connector';
import { decodeChallengeNonce } from '@/lib/near/nep413';

const LOGIN_NETWORK = 'testnet' as const;

export function nearLoginMessage(accountId: string, nonce: string): string {
  return JSON.stringify({ account: accountId, kind: 'login', nonce, v: 1 });
}

export async function signInWithNear(): Promise<SessionAccount> {
  const { NearConnector } = await import('@hot-labs/near-connect');
  const connector = new NearConnector({
    network: LOGIN_NETWORK,
    features: { signMessage: true, signAndSendTransaction: true },
  });
  try {
    const wallet = await connector.connect();
    const accounts = await wallet.getAccounts({ network: LOGIN_NETWORK });
    const accountId = accounts[0]?.accountId;
    if (!accountId) throw new AppError('WALLET_UNAVAILABLE', 'The wallet returned no account');
    const challenge = await api.challenge();
    const signed = await wallet.signMessage({
      message: nearLoginMessage(accountId, challenge.nonce),
      recipient: env.intakeRecipient,
      nonce: decodeChallengeNonce(challenge.nonce),
      network: LOGIN_NETWORK,
      signerId: accountId,
    });
    return await api.loginNear({
      accountId,
      publicKey: signed.publicKey,
      signature: signed.signature,
      nonce: challenge.nonce,
    });
  } catch (error) {
    throw normalizeWalletError(error);
  }
}
