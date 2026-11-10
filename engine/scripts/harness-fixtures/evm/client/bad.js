const relayer = new Wallet('0x2222222222222222222222222222222222222222222222222222222222222222');
const rpc = 'https://mainnet.infura.io/v3/00000000000000000000000000000000';
await window.ethereum.request({ method: 'eth_sign', params: [account, hash] });
await token.approve(spender, MaxUint256);
await signer.signTypedData(domain, types, value);
await walletClient.signAuthorization({ contractAddress: target });
await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [chain] });
