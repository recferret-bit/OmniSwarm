const relayer = new Wallet('0x2222222222222222222222222222222222222222222222222222222222222222');
await window.ethereum.request({ method: 'eth_sign', params: [account, hash] });
await token.approve(spender, MaxUint256);
await signer.signTypedData(domain, types, value);
