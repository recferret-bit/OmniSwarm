import { connect, keyStores, WalletConnection, utils } from 'near-api-js';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

const CONTRACT_ID = 'tipjar.near';
const VAULT_PROGRAM = new PublicKey('TipVau1t11111111111111111111111111111111111');

export async function connectNear() {
  const near = await connect({
    networkId: 'mainnet',
    nodeUrl: 'https://rpc.mainnet.near.org',
    walletUrl: 'https://app.mynearwallet.com',
    keyStore: new keyStores.BrowserLocalStorageKeyStore(),
  });
  const wallet = new WalletConnection(near, 'tipjar');
  if (!wallet.isSignedIn()) {
    await wallet.requestSignIn({ contractId: CONTRACT_ID, methodNames: [], allowance: utils.format.parseNearAmount('250') });
  }
  return wallet;
}

export async function tipNear(wallet, creator, amount) {
  return wallet.account().functionCall({
    contractId: CONTRACT_ID,
    methodName: 'tip',
    args: { creator },
    attachedDeposit: utils.format.parseNearAmount(String(amount)),
  });
}

export async function connectSolana() {
  const provider = window.solana;
  await provider.connect();
  return provider;
}

export async function signMessage(provider, message) {
  const encoded = new TextEncoder().encode(message);
  const { signature } = await provider.signMessage(encoded, 'utf8');
  return signature;
}

export async function tipSolana(provider, creator, lamports) {
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: provider.publicKey, toPubkey: new PublicKey(creator), lamports }),
  );
  tx.feePayer = provider.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signed = await provider.signTransaction(tx);
  return connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
}

export async function signPrepared(provider, base64Tx) {
  const tx = Transaction.from(Buffer.from(base64Tx, 'base64'));
  const signed = await provider.signTransaction(tx);
  return signed.serialize().toString('base64');
}

export { VAULT_PROGRAM };
