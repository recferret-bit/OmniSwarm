import { connect, keyStores, WalletConnection, utils } from 'near-api-js';

const CONTRACT_ID = 'tipjar.near';

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

export async function signNep413Login(wallet, message, untrustedRecipient) {
  const nonce = new Uint8Array(32);
  return wallet.signMessage({ message, recipient: untrustedRecipient, nonce });
}
