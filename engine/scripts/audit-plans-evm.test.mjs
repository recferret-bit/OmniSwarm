// The EVM checklist (audit-plans-data-evm.mjs) and the EVM lead patterns: coverage of the OWASP Smart Contract
// Top 10 2026, routing by surface and by what the target contains, and what each trickier lead must and must
// not match.
import assert from 'node:assert/strict';
import test from 'node:test';
import { EVM_CHECKS, EVM_GROUPS, evmSurfaceLines } from './audit-plans-data-evm.mjs';
import { EVM_CLIENT_PATTERNS, EVM_CONTRACT_PATTERNS } from './harness-patterns-chain.mjs';

const hits = (list, id, text) => { const { re } = list.find((p) => p.id === id); re.lastIndex = 0; return re.test(text); };
const contract = (id, text) => hits(EVM_CONTRACT_PATTERNS, id, text);
const client = (id, text) => hits(EVM_CLIENT_PATTERNS, id, text);

test('the checklist covers every OWASP Smart Contract Top 10 2026 entry and each area the list leaves out', () => {
  for (const id of ['SC01', 'SC02', 'SC03', 'SC04', 'SC05', 'SC06', 'SC07', 'SC08', 'SC09', 'SC10', 'SIG', 'ACCT', 'L2', 'DOS', 'KEYS', 'BUILD', 'WALLET']) {
    assert.ok(EVM_CHECKS.some((row) => row.group === id), `no check for ${id}`);
  }
  for (const row of EVM_CHECKS) {
    assert.ok(EVM_GROUPS[row.group], row.group);
    assert.match(row.surface, /^S[1-6]$/);
    assert.ok(['contract', 'client'].includes(row.kind));
    assert.ok(row.text.length > 60 && row.text.length < 520, `${row.group}: one or two sentences`);
  }
  assert.ok(EVM_CHECKS.filter((row) => row.group === 'WALLET').every((row) => row.kind === 'client'));
  assert.ok(EVM_CHECKS.filter((row) => row.group !== 'WALLET').every((row) => row.kind === 'contract'));
});

test('the checklist describes controls to read, never how to break them', () => {
  const text = EVM_CHECKS.map((row) => row.text).join('\n');
  assert.doesNotMatch(text, /\b(?:exploit|payload|proof of concept|PoC|attack script|drain it|send a transaction)\b/i);
  // The two things a reviewer must not do in this sandbox are stated.
  assert.match(text, /Do not install them/);
  assert.match(text, /were not executed: say so as a coverage gap/);
});

test('each surface gets its own rows, filtered by what the target contains', () => {
  const s3 = evmSurfaceLines('S3');
  for (const tag of ['SC02', 'SC03', 'SC04', 'SC06', 'SC07', 'SC08', 'SC09']) assert.ok(s3.some((line) => line.includes(`[${tag} `)), `S3 lacks ${tag}`);
  assert.ok(s3.every((line) => line.startsWith('- EVM [')));
  assert.equal(s3.some((line) => /SC01|SC10|Wallet client/.test(line)), false, 'access control, proxies and wallet rows are not S3');
  assert.ok(evmSurfaceLines('S1').some((line) => line.includes('[SC01 ')));
  assert.ok(evmSurfaceLines('S1').some((line) => line.includes('[SC10 ')));
  // A contract-only target gets no wallet rows; a client-only target gets nothing but wallet rows.
  for (const code of ['S1', 'S4', 'S6']) {
    assert.equal(evmSurfaceLines(code, ['contract']).some((line) => line.includes('[Wallet client]')), false, code);
    assert.ok(evmSurfaceLines(code, ['client']).every((line) => line.includes('[Wallet client]')), code);
    assert.ok(evmSurfaceLines(code, ['client']).length > 0, code);
  }
  assert.deepEqual(evmSurfaceLines('S6', ['contract']), []);
  assert.deepEqual(evmSurfaceLines('S3', ['client']), []);
  assert.deepEqual(evmSurfaceLines('S3', []), []);
  assert.deepEqual(evmSurfaceLines('S9'), []);
});

test('every contract lead names its category, and the Top 10 entries a regex can reach have one', () => {
  const classes = EVM_CONTRACT_PATTERNS.map((p) => p.cls).join(' | ');
  for (const id of ['SC01', 'SC03', 'SC05', 'SC06', 'SC07', 'SC08', 'SC09', 'SC10']) assert.ok(classes.includes(id), `no lead for ${id}`);
  assert.equal(new Set(EVM_CONTRACT_PATTERNS.map((p) => p.id)).size, EVM_CONTRACT_PATTERNS.length);
  assert.equal(new Set(EVM_CLIENT_PATTERNS.map((p) => p.id)).size, EVM_CLIENT_PATTERNS.length);
});

test('contract leads match the risky form', () => {
  assert.ok(contract('eoa-check', 'require(msg.sender == tx.origin, "no contracts");'));
  assert.ok(contract('eoa-check', 'if (account.code.length == 0) revert();'));
  assert.ok(contract('eoa-check', 'size := extcodesize(account)'));
  assert.ok(contract('narrowing-cast', 'rewards[c] += uint96(amount);'));
  assert.ok(contract('narrowing-cast', 'int128 d = int128(delta);'));
  assert.ok(contract('div-before-mul', 'return amount / 10000 * bps;'));
  assert.ok(contract('eth-transfer-send', 'payable(msg.sender).transfer(amount);'));
  assert.ok(contract('token-hook', 'IERC721(nft).safeTransferFrom(address(this), to, id);'));
  assert.ok(contract('token-hook', '_safeMint(to, id);'));
  assert.ok(contract('spot-price', '(uint112 a, uint112 b, ) = pair.getReserves();'));
  assert.ok(contract('spot-price', 'return asset.balanceOf(address(this));'));
  assert.ok(contract('oracle-read', 'int256 p = feed.latestAnswer();'));
  assert.ok(contract('erc20-unchecked', 'IERC20(token).transfer(to, amount);'));
  assert.ok(contract('initializer', 'function initialize(address owner_) external {'));
  assert.ok(contract('unbounded-loop', 'for (uint256 i = 0; i < creators.length; i++) {'));
  assert.ok(contract('permit', 'IERC20Permit(token).permit(owner, spender, value, deadline, v, r, s);'));
  assert.ok(contract('old-pragma', 'pragma solidity ^0.7.6;'));
  assert.ok(contract('floating-pragma', 'pragma solidity >=0.8.0;'));
});

test('contract leads leave the safe form alone', () => {
  assert.equal(contract('eoa-check', 'require(msg.sender == owner, "owner only");'), false);
  assert.equal(contract('tx-origin', 'emit Tipped(msg.sender, creator, amount);'), false);
  // Widening and same-width casts, and a constructor-style address cast.
  assert.equal(contract('narrowing-cast', 'return uint256(small);'), false);
  assert.equal(contract('narrowing-cast', 'address a = address(uint160(1));'), false);
  assert.equal(contract('narrowing-cast', 'mapping(address => uint96) public rewards;'), false);
  assert.equal(contract('div-before-mul', 'return amount * bps / 10000;'), false);
  // An ERC-20 transfer has two arguments; it is not an ether send.
  assert.equal(contract('eth-transfer-send', 'token.transfer(to, amount);'), false);
  // SafeERC20 on a token does not call the recipient.
  assert.equal(contract('token-hook', 'token.safeTransferFrom(msg.sender, address(this), amount);'), false);
  assert.equal(contract('erc20-unchecked', 'token.safeTransfer(to, amount);'), false);
  assert.equal(contract('spot-price', 'return token.balanceOf(msg.sender);'), false);
  assert.equal(contract('unbounded-loop', 'for (uint256 i = 0; i < 10; i++) {'), false);
  assert.equal(contract('old-pragma', 'pragma solidity 0.8.26;'), false);
  assert.equal(contract('floating-pragma', 'pragma solidity 0.8.26;'), false);
  assert.equal(contract('initializer', 'function initializedVersion() external view returns (uint8) {'), false);
});

test('client leads match the risky form and leave the safe form alone', () => {
  assert.ok(client('eth-sign', "request({ method: 'eth_sign', params })"));
  assert.equal(client('eth-sign', "request({ method: 'personal_sign', params })"), false);
  assert.ok(client('unlimited-approval', 'await nft.setApprovalForAll(operator, true);'));
  assert.ok(client('unlimited-approval', 'await token.approve(spender, MaxUint256);'));
  assert.equal(client('unlimited-approval', 'await token.approve(spender, amount);'), false);
  assert.ok(client('eip7702-authorization', 'await walletClient.signAuthorization({ contractAddress });'));
  assert.equal(client('eip7702-authorization', 'await signer.signMessage(message);'), false);
  assert.ok(client('rpc-key-url', "const rpc = 'https://mainnet.infura.io/v3/0123456789abcdef0123456789abcdef';"));
  assert.equal(client('rpc-key-url', "const rpc = 'https://rpc.example.org';"), false);
  assert.equal(client('rpc-key-url', "const rpc = 'https://mainnet.infura.io/v3/' + process.env.KEY;"), false);
  // A contract address is 20 bytes; a private key or hash is 32.
  assert.ok(client('evm-private-key', `const k = '0x${'1'.repeat(64)}';`));
  assert.equal(client('evm-private-key', `const vault = '0x${'a'.repeat(40)}';`), false);
  assert.ok(client('chain-switch', "request({ method: 'wallet_addEthereumChain', params: [chain] })"));
  assert.equal(client('chain-switch', "request({ method: 'eth_chainId' })"), false);
});
