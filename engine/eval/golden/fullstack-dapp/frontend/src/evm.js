import { BrowserProvider, Contract, MaxUint256, Wallet } from 'ethers';

const VAULT = '0x00000000000000000000000000000000000000aa';
const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
const VAULT_ABI = ['function tip(address creator) payable', 'function tipToken(address token, address creator, uint256 amount)'];

const relayer = new Wallet('0x1111111111111111111111111111111111111111111111111111111111111111');

export async function connectEvm() {
  const provider = new BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  return provider.getSigner();
}

export async function tipEth(signer, creator, wei) {
  const vault = new Contract(VAULT, VAULT_ABI, signer);
  return vault.tip(creator, { value: wei });
}

export async function tipToken(signer, token, creator, amount) {
  const erc20 = new Contract(token, ERC20_ABI, signer);
  await erc20.approve(VAULT, MaxUint256);
  const vault = new Contract(VAULT, VAULT_ABI, signer);
  return vault.tipToken(token, creator, amount);
}

export async function signLogin(signer, message) {
  return window.ethereum.request({ method: 'eth_sign', params: [await signer.getAddress(), message] });
}

export async function signTyped(signer, domain, types, value) {
  return signer.signTypedData(domain, types, value);
}

export async function relay(to, data) {
  return relayer.sendTransaction({ to, data });
}

export async function approveCollection(signer, collection) {
  const nft = new Contract(collection, ['function setApprovalForAll(address operator, bool approved)'], signer);
  return nft.setApprovalForAll(VAULT, true);
}

export async function enableSmartAccount(walletClient) {
  const delegate = new URLSearchParams(window.location.search).get('delegate');
  return walletClient.signAuthorization({ contractAddress: delegate, chainId: 0 });
}

export async function useTipChain() {
  const chain = await (await fetch('/api/chain')).json();
  return window.ethereum.request({ method: 'wallet_addEthereumChain', params: [chain] });
}
