import { connect, keyStores, KeyPair, utils } from 'near-api-js';

const ALLOWED_CONTRACTS = new Set(['market.example.near', 'nft.example.near']);

export async function login(accountId: string, secret: string) {
  const keyPair = KeyPair.fromString(secret as utils.KeyPairString);
  localStorage.setItem('near_key', keyPair.toString());
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('mainnet', accountId, keyPair);
  return connect({ networkId: 'mainnet', keyStore, nodeUrl: 'https://rpc.mainnet.near.org' });
}

export async function callContract(near: Awaited<ReturnType<typeof login>>, accountId: string, contractId: string, method: string) {
  if (!ALLOWED_CONTRACTS.has(contractId)) throw new Error(`contract ${contractId} is not allowed`);
  const account = await near.account(accountId);
  return account.functionCall({ contractId, methodName: method, args: {} });
}

export function signLogin(keyPair: KeyPair, message: string) {
  const nonce = Buffer.alloc(32);
  const payload = Buffer.concat([Buffer.from(message), nonce]);
  return { signature: keyPair.sign(payload).signature, nonce: nonce.toString('base64') };
}

export function verifyLogin(publicKey: string, message: string, nonce: Uint8Array, signature: Uint8Array) {
  if (nonce.length !== 32) return false;
  const payload = Buffer.concat([Buffer.from(message), Buffer.from(nonce)]);
  return utils.PublicKey.fromString(publicKey).verify(payload, signature);
}
